import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Box,
  Text,
  measureElement,
  useCursor,
  useInput,
  type DOMElement,
} from "ink";
import stringWidth from "string-width";

interface ImeTextInputProps {
  value: string;
  placeholder?: string;
  cursorPosition?: Position;
  onChange(value: string): void;
  onSubmit?(value: string): void;
}

interface Position {
  x: number;
  y: number;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function ImeTextInput({
  value,
  placeholder = "",
  cursorPosition,
  onChange,
  onSubmit,
}: ImeTextInputProps) {
  const inputRef = useRef<DOMElement | null>(null);
  const [position, setPosition] = useState<Position>();
  const [cursorOffset, setCursorOffset] = useState(value.length);
  const { setCursorPosition } = useCursor();

  useLayoutEffect(() => {
    if (cursorPosition) return;
    if (!inputRef.current) return;
    const measured = measureElement(inputRef.current);
    setPosition((previous) =>
      previous?.x === measured.x && previous.y === measured.y
        ? previous
        : { x: measured.x, y: measured.y },
    );
  });

  useEffect(() => {
    setCursorOffset((offset) => Math.min(offset, value.length));
  }, [value]);

  const safeOffset = Math.min(cursorOffset, value.length);
  const inputPosition = cursorPosition ?? position;
  if (inputPosition) {
    setCursorPosition({
      x: inputPosition.x + stringWidth(value.slice(0, safeOffset)),
      y: inputPosition.y,
    });
  } else {
    setCursorPosition(undefined);
  }

  useInput((input, key) => {
    if (
      key.upArrow ||
      key.downArrow ||
      (key.ctrl && input === "c") ||
      key.tab ||
      (key.shift && key.tab)
    ) {
      return;
    }
    if (key.return) {
      onSubmit?.(value);
      return;
    }

    if (key.leftArrow) {
      setCursorOffset(previousGraphemeOffset(value, safeOffset));
      return;
    }
    if (key.rightArrow) {
      setCursorOffset(nextGraphemeOffset(value, safeOffset));
      return;
    }
    if (key.backspace || key.delete) {
      if (safeOffset === 0) return;
      const previousOffset = previousGraphemeOffset(value, safeOffset);
      onChange(value.slice(0, previousOffset) + value.slice(safeOffset));
      setCursorOffset(previousOffset);
      return;
    }
    if (!input) return;

    onChange(value.slice(0, safeOffset) + input + value.slice(safeOffset));
    setCursorOffset(safeOffset + input.length);
  });

  return (
    <Box ref={inputRef} minWidth={1}>
      {value ? <Text>{value}</Text> : <Text dimColor>{placeholder}</Text>}
    </Box>
  );
}

export function previousGraphemeOffset(value: string, offset: number): number {
  let previous = 0;
  for (const segment of graphemeSegmenter.segment(value)) {
    if (segment.index >= offset) break;
    previous = segment.index;
  }
  return previous;
}

export function nextGraphemeOffset(value: string, offset: number): number {
  for (const segment of graphemeSegmenter.segment(value)) {
    if (segment.index > offset) return segment.index;
  }
  return value.length;
}
