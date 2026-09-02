import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3,
      let x = Double(CommandLine.arguments[1]),
      let y = Double(CommandLine.arguments[2]) else {
  fputs("usage: kakao-double-click.swift <x> <y>\n", stderr)
  exit(2)
}

let originalPosition = CGEvent(source: nil)?.location
let target = CGPoint(x: x, y: y)

func post(_ type: CGEventType, clickCount: Int64) {
  guard let event = CGEvent(
    mouseEventSource: nil,
    mouseType: type,
    mouseCursorPosition: target,
    mouseButton: .left
  ) else { return }
  event.setIntegerValueField(.mouseEventClickState, value: clickCount)
  event.post(tap: .cghidEventTap)
}

post(.leftMouseDown, clickCount: 1)
post(.leftMouseUp, clickCount: 1)
usleep(120_000)
post(.leftMouseDown, clickCount: 2)
post(.leftMouseUp, clickCount: 2)
usleep(120_000)

if let originalPosition {
  CGWarpMouseCursorPosition(originalPosition)
}
