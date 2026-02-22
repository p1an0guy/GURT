import assert from "node:assert/strict";
import test from "node:test";

import {
  readCourseHistory,
  readSelectedCourseId,
  writeCourseHistory,
  writeSelectedCourseId,
  type ChatMessage,
} from "./store.ts";

class MemoryStorage {
  private readonly map = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key) ?? null : null;
  }

  public setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  public removeItem(key: string): void {
    this.map.delete(key);
  }
}

function installWindow(storage: MemoryStorage): void {
  (globalThis as unknown as { window?: { localStorage: Storage } }).window = {
    localStorage: storage as unknown as Storage,
  };
}

function clearWindow(): void {
  delete (globalThis as unknown as { window?: unknown }).window;
}

test("writes and reads selected course id", () => {
  const storage = new MemoryStorage();
  installWindow(storage);

  writeSelectedCourseId(" course-1 ");
  assert.equal(readSelectedCourseId(), "course-1");

  writeSelectedCourseId(null);
  assert.equal(readSelectedCourseId(), null);

  clearWindow();
});

test("stores history per course", () => {
  const storage = new MemoryStorage();
  installWindow(storage);

  const courseOneHistory: ChatMessage[] = [{ role: "user", text: "hello from one" }];
  const courseTwoHistory: ChatMessage[] = [{ role: "assistant", text: "hello from two" }];

  writeCourseHistory("course-1", courseOneHistory);
  writeCourseHistory("course-2", courseTwoHistory);

  assert.deepEqual(readCourseHistory("course-1"), courseOneHistory);
  assert.deepEqual(readCourseHistory("course-2"), courseTwoHistory);

  clearWindow();
});

test("caps stored history to 100 messages", () => {
  const storage = new MemoryStorage();
  installWindow(storage);

  const longHistory: ChatMessage[] = Array.from({ length: 105 }, (_unused, index) => ({
    role: "user",
    text: `message-${index + 1}`,
  }));

  writeCourseHistory("course-cap", longHistory);
  const loaded = readCourseHistory("course-cap");

  assert.equal(loaded.length, 100);
  assert.equal(loaded[0]?.text, "message-6");
  assert.equal(loaded[99]?.text, "message-105");

  clearWindow();
});

test("falls back to empty history for invalid stored payloads", () => {
  const storage = new MemoryStorage();
  installWindow(storage);

  storage.setItem("gurt.chat.v1.history.course-1", "not-json");
  assert.deepEqual(readCourseHistory("course-1"), []);

  storage.setItem("gurt.chat.v1.history.course-1", JSON.stringify([{ role: "bad-role", text: 3 }]));
  assert.deepEqual(readCourseHistory("course-1"), []);

  clearWindow();
});
