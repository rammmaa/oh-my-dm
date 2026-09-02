import ApplicationServices
import AppKit
import Foundation

enum ReaderError: Error, CustomStringConvertible {
  case message(String)

  var description: String {
    switch self {
    case .message(let value): return value
    }
  }
}

func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
  return value
}

func children(of element: AXUIElement) -> [AXUIElement] {
  attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? []
}

func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String? {
  attribute(element, name) as? String
}

func role(of element: AXUIElement) -> String {
  stringAttribute(element, kAXRoleAttribute as CFString) ?? ""
}

func title(of element: AXUIElement) -> String {
  stringAttribute(element, kAXTitleAttribute as CFString)
    ?? stringAttribute(element, kAXValueAttribute as CFString)
    ?? ""
}

func position(of element: AXUIElement) -> CGPoint? {
  guard let value = attribute(element, kAXPositionAttribute as CFString) else { return nil }
  let axValue = unsafeBitCast(value, to: AXValue.self)
  guard AXValueGetType(axValue) == .cgPoint else { return nil }
  var point = CGPoint.zero
  guard AXValueGetValue(axValue, .cgPoint, &point) else { return nil }
  return point
}

func size(of element: AXUIElement) -> CGSize? {
  guard let value = attribute(element, kAXSizeAttribute as CFString) else { return nil }
  let axValue = unsafeBitCast(value, to: AXValue.self)
  guard AXValueGetType(axValue) == .cgSize else { return nil }
  var size = CGSize.zero
  guard AXValueGetValue(axValue, .cgSize, &size) else { return nil }
  return size
}

func descendants(of element: AXUIElement, matching targetRole: String) -> [AXUIElement] {
  var result: [AXUIElement] = []
  var pending = children(of: element)
  while let current = pending.popLast() {
    if role(of: current) == targetRole { result.append(current) }
    pending.append(contentsOf: children(of: current))
  }
  return result
}

func senderCandidate(_ value: String) -> String? {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !trimmed.isEmpty else { return nil }
  if trimmed == "수정됨" || trimmed == "삭제됨" { return nil }
  let lines = trimmed.split(whereSeparator: \Character.isNewline).map {
    String($0).trimmingCharacters(in: .whitespaces)
  }
  if lines.contains(where: { $0.hasPrefix("오전 ") || $0.hasPrefix("오후 ") }) { return nil }
  if trimmed.range(of: #"^\d+\+?$"#, options: .regularExpression) != nil { return nil }
  return trimmed
}

func run() throws {
  guard CommandLine.arguments.count >= 3 else {
    throw ReaderError.message("usage: kakao-read-messages.swift <window-title> <newer|older>")
  }
  let windowTitle = CommandLine.arguments[1]
  let direction = CommandLine.arguments[2]
  guard let application = NSWorkspace.shared.runningApplications.first(where: {
    $0.bundleIdentifier == "com.kakao.KakaoTalkMac" || $0.localizedName == "KakaoTalk"
  }) else {
    throw ReaderError.message("KakaoTalk이 실행 중이 아닙니다.")
  }

  let appElement = AXUIElementCreateApplication(application.processIdentifier)
  let windows = attribute(appElement, kAXWindowsAttribute as CFString) as? [AXUIElement] ?? []
  guard let window = windows.first(where: {
    stringAttribute($0, kAXTitleAttribute as CFString) == windowTitle
  }) else {
    throw ReaderError.message("KakaoTalk 대화창을 찾을 수 없습니다: \(windowTitle)")
  }
  guard let windowPosition = position(of: window), let windowSize = size(of: window) else {
    throw ReaderError.message("KakaoTalk 대화창 좌표를 읽을 수 없습니다.")
  }
  let scrollAreas = children(of: window).filter { role(of: $0) == kAXScrollAreaRole as String }
  guard let messageTable = scrollAreas.first.flatMap({ area in
    children(of: area).first(where: { role(of: $0) == kAXTableRole as String })
  }) else {
    throw ReaderError.message("KakaoTalk 메시지 표를 찾을 수 없습니다.")
  }

  let rows = children(of: messageTable).filter { role(of: $0) == kAXRowRole as String }
  let windowSizeLimit = 20
  let selectedRows: ArraySlice<AXUIElement>
  if direction == "older" {
    selectedRows = rows.prefix(windowSizeLimit)
  } else {
    selectedRows = rows.suffix(windowSizeLimit)
  }

  var output: [[String: String]] = []
  var lastSender = ""
  for row in selectedRows {
    guard let cell = children(of: row).first else { continue }
    let cellElements = children(of: cell)
    let textAreas = cellElements.filter { role(of: $0) == kAXTextAreaRole as String }
    let labels = cellElements.filter { role(of: $0) == kAXStaticTextRole as String }
    guard let messageArea = textAreas.last,
          let rawMessageText = stringAttribute(messageArea, kAXValueAttribute as CFString),
          !rawMessageText.isEmpty,
          let messagePosition = position(of: messageArea),
          let messageSize = size(of: messageArea) else { continue }
    let messageText = rawMessageText.trimmingCharacters(in: .whitespacesAndNewlines)
    if messageText == "여기까지 읽었습니다." ||
       messageText == "여기까지 읽었습니다" ||
       messageText == "메시지가 삭제되었습니다." ||
       messageText == "메시지가 삭제되었습니다" { continue }
    let isEdited = labels.contains {
      title(of: $0).trimmingCharacters(in: .whitespacesAndNewlines) == "수정됨"
    }

    var sender = "나"
    let leftInset = messagePosition.x - windowPosition.x
    let rightInset = windowPosition.x + windowSize.width - (messagePosition.x + messageSize.width)
    if leftInset <= rightInset {
      for label in labels {
        if let value = stringAttribute(label, kAXValueAttribute as CFString),
           let candidate = senderCandidate(value) { lastSender = candidate }
      }
      sender = lastSender.isEmpty ? "unknown" : lastSender
    }
    output.append(["text": isEdited ? "\(messageText) (수정됨)" : messageText, "sender": sender])
  }

  let data = try JSONSerialization.data(withJSONObject: output, options: [])
  FileHandle.standardOutput.write(data)
}

do {
  try run()
} catch {
  fputs("\(error)\n", stderr)
  exit(1)
}
