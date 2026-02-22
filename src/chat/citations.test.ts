import assert from "node:assert/strict";
import test from "node:test";

import { getRenderableChatCitations } from "./citations.ts";

test("prefers structured citationDetails when present", () => {
  const citations = getRenderableChatCitations({
    answer: "Answer",
    citations: ["s3://bucket/uploads/course/doc.pdf#chunk-1"],
    citationDetails: [
      {
        source: "s3://bucket/uploads/course/doc.pdf#chunk-1",
        label: "doc.pdf (chunk-1)",
        url: "https://bucket.s3.us-west-2.amazonaws.com/uploads/course/doc.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=example",
      },
    ],
  });

  assert.deepEqual(citations, [
    {
      source: "s3://bucket/uploads/course/doc.pdf#chunk-1",
      label: "doc.pdf (chunk-1)",
      url: "https://bucket.s3.us-west-2.amazonaws.com/uploads/course/doc.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=example",
    },
  ]);
});

test("falls back to legacy https citations when structured details are absent", () => {
  const citations = getRenderableChatCitations({
    answer: "Answer",
    citations: [
      "https://example.com/lecture-2.pdf",
      "s3://bucket/uploads/course/doc.pdf#chunk-2",
    ],
  });

  assert.deepEqual(citations, [
    {
      source: "https://example.com/lecture-2.pdf",
      label: "https://example.com/lecture-2.pdf",
      url: "https://example.com/lecture-2.pdf",
    },
  ]);
});

test("filters non-https structured citation links", () => {
  const citations = getRenderableChatCitations({
    answer: "Answer",
    citations: [],
    citationDetails: [
      {
        source: "http://example.com/doc.pdf",
        label: "doc.pdf",
        url: "http://example.com/doc.pdf",
      },
    ],
  });

  assert.deepEqual(citations, []);
});
