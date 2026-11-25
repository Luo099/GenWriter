package com.example.genwriter.service.workspace;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure text numbering, search, prose-friendly anchor patching, and LCS unified diff utilities.
 */
public final class TextPatchEngine {

    private static final int DIFF_CONTEXT_LINES = 2;

    private TextPatchEngine() {}

    public enum HunkMode {
        REPLACE,
        INSERT_AFTER,
        INSERT_BEFORE,
        APPEND,
        DELETE
    }

    public record PatchHunk(HunkMode mode, String anchor, String content, Integer nearLine) {}

    public record ReadWindow(int startLine, int endLine, int totalLines, int totalChars,
                             boolean hasMore, String numberedContent, String headingsOutline) {}

    public record DiffResult(String unifiedDiff, int addedLines, int removedLines,
                             int beforeChars, int afterChars) {}

    public record PatchApplication(String updatedContent, DiffResult diff, int hunksApplied) {}

    public static String normalizeLineEndings(String text) {
        if (text == null) return "";
        return text.replace("\r\n", "\n").replace("\r", "\n");
    }

    public static List<String> splitLines(String text) {
        String normalized = normalizeLineEndings(text);
        if (normalized.isEmpty()) {
            return List.of();
        }
        return Arrays.asList(normalized.split("\n", -1));
    }

    public static int countLines(String text) {
        return splitLines(text).size();
    }

    public static ReadWindow readWindow(String rawContent, int requestedStartLine, int requestedLineCount) {
        String normalized = normalizeLineEndings(rawContent);
        List<String> lines = splitLines(normalized);
        int totalLines = lines.size();
        int totalChars = normalized.length();
        String headingsOutline = extractHeadingsOutline(lines);

        if (totalLines == 0) {
            return new ReadWindow(1, 0, 0, 0, false, "(当前章节正文为空)", headingsOutline);
        }

        int startLine = Math.max(1, requestedStartLine);
        if (startLine > totalLines) {
            return new ReadWindow(startLine, totalLines, totalLines, totalChars, false,
                    "(起始行 " + startLine + " 超出总行数 " + totalLines + ")", headingsOutline);
        }

        int limit = Math.max(1, requestedLineCount);
        int endLine = Math.min(totalLines, startLine + limit - 1);
        StringBuilder sb = new StringBuilder();
        for (int lineNo = startLine; lineNo <= endLine; lineNo++) {
            if (!sb.isEmpty()) sb.append('\n');
            sb.append("L").append(lineNo).append("| ").append(lines.get(lineNo - 1));
        }
        return new ReadWindow(startLine, endLine, totalLines, totalChars, endLine < totalLines,
                sb.toString(), headingsOutline);
    }

    public static String extractHeadingsOutline(List<String> lines) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < lines.size(); i++) {
            String trimmed = lines.get(i).trim();
            if (trimmed.startsWith("#")) {
                if (!sb.isEmpty()) sb.append('\n');
                sb.append("L").append(i + 1).append(": ").append(trimmed);
            }
        }
        return sb.toString();
    }

    public static PatchApplication applyHunks(String originalContent, List<PatchHunk> hunks) {
        if (hunks == null || hunks.isEmpty()) {
            throw new IllegalArgumentException("补丁 hunks 不能为空");
        }
        String before = normalizeLineEndings(originalContent);
        String working = before;
        int applied = 0;

        for (int idx = 0; idx < hunks.size(); idx++) {
            PatchHunk hunk = hunks.get(idx);
            if (hunk == null || hunk.mode() == null) {
                throw new IllegalArgumentException("第 " + (idx + 1) + " 个 hunk 缺少操作类型 mode");
            }
            working = applySingleHunk(working, hunk, idx + 1);
            applied++;
        }

        DiffResult diff = computeDiff("chapter", before, working);
        return new PatchApplication(working, diff, applied);
    }

    private static String applySingleHunk(String doc, PatchHunk hunk, int hunkNumber) {
        HunkMode mode = hunk.mode();
        String newText = normalizeLineEndings(hunk.content());
        if (mode == HunkMode.APPEND) {
            if (newText.isBlank()) {
                throw new IllegalArgumentException("第 " + hunkNumber + " 个 APPEND hunk 的 content 不能为空");
            }
            if (doc.isBlank()) {
                return newText;
            }
            String separator = doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
            return doc + separator + newText;
        }

        String anchor = normalizeLineEndings(hunk.anchor());
        if (anchor.isEmpty()) {
            throw new IllegalArgumentException("第 " + hunkNumber + " 个 " + mode + " hunk 缺少定位锚点 anchor");
        }
        if ((mode == HunkMode.REPLACE || mode == HunkMode.INSERT_AFTER || mode == HunkMode.INSERT_BEFORE)
                && hunk.content() == null) {
            throw new IllegalArgumentException("第 " + hunkNumber + " 个 " + mode + " hunk 缺少 content");
        }

        MatchSpan span = resolveUniqueMatch(doc, anchor, hunk.nearLine(), hunkNumber);
        return switch (mode) {
            case REPLACE -> doc.substring(0, span.start()) + newText + doc.substring(span.end());
            case DELETE -> cleanDeletedBoundary(doc.substring(0, span.start()), doc.substring(span.end()));
            case INSERT_AFTER -> {
                String sep = needsParagraphBreak(doc.substring(0, span.end()), newText) ? "\n\n" : "";
                yield doc.substring(0, span.end()) + sep + newText + doc.substring(span.end());
            }
            case INSERT_BEFORE -> {
                String sep = needsParagraphBreak(newText, doc.substring(span.start())) ? "\n\n" : "";
                yield doc.substring(0, span.start()) + newText + sep + doc.substring(span.start());
            }
            case APPEND -> doc;
        };
    }

    private static boolean needsParagraphBreak(String left, String right) {
        if (left.isEmpty() || right.isEmpty()) return false;
        return !left.endsWith("\n") && !right.startsWith("\n");
    }

    private static String cleanDeletedBoundary(String left, String right) {
        if (left.endsWith("\n\n") && right.startsWith("\n")) {
            return left + right.replaceFirst("^\n+", "");
        }
        if (left.isEmpty() && right.startsWith("\n")) {
            return right.replaceFirst("^\n+", "");
        }
        return left + right;
    }

    private record MatchSpan(int start, int end, int lineNumber) {}

    private static MatchSpan resolveUniqueMatch(String doc, String anchor, Integer nearLine, int hunkNumber) {
        List<MatchSpan> exactMatches = findExactMatches(doc, anchor);
        if (exactMatches.size() == 1) {
            return exactMatches.get(0);
        }
        if (exactMatches.size() > 1) {
            return disambiguate(exactMatches, nearLine, hunkNumber, anchor);
        }

        // Line-trimmed fallback if exact match missed only due to trailing/leading line spaces.
        List<MatchSpan> trimmedMatches = findLineTrimmedMatches(doc, anchor);
        if (trimmedMatches.size() == 1) {
            return trimmedMatches.get(0);
        }
        if (trimmedMatches.size() > 1) {
            return disambiguate(trimmedMatches, nearLine, hunkNumber, anchor);
        }

        String hint = closestLineHint(doc, anchor);
        throw new IllegalArgumentException("第 " + hunkNumber + " 个补丁未找到匹配锚点，请重新 workspace_read 核对原文。" + hint);
    }

    private static MatchSpan disambiguate(List<MatchSpan> matches, Integer nearLine, int hunkNumber, String anchor) {
        List<Integer> lines = matches.stream().map(MatchSpan::lineNumber).toList();
        if (nearLine != null && nearLine > 0) {
            int bestDist = Integer.MAX_VALUE;
            MatchSpan best = null;
            boolean tie = false;
            for (MatchSpan m : matches) {
                int dist = Math.abs(m.lineNumber() - nearLine);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = m;
                    tie = false;
                } else if (dist == bestDist) {
                    tie = true;
                }
            }
            if (best != null && !tie && bestDist <= 20) {
                return best;
            }
        }
        String preview = anchor.length() > 40 ? anchor.substring(0, 40) + "..." : anchor;
        throw new IllegalArgumentException("第 " + hunkNumber + " 个补丁锚点「" + preview
                + "」在文中匹配到 " + matches.size() + " 处（第 " + lines + " 行），请提供更长上下文或指定 nearLine");
    }

    private static List<MatchSpan> findExactMatches(String doc, String anchor) {
        List<MatchSpan> matches = new ArrayList<>();
        int from = 0;
        while (from <= doc.length()) {
            int idx = doc.indexOf(anchor, from);
            if (idx < 0) break;
            matches.add(new MatchSpan(idx, idx + anchor.length(), lineAtOffset(doc, idx)));
            from = idx + Math.max(1, anchor.length());
        }
        return matches;
    }

    private static List<MatchSpan> findLineTrimmedMatches(String doc, String anchor) {
        List<String> docLines = splitLines(doc);
        List<String> anchorLines = splitLines(anchor);
        if (docLines.isEmpty() || anchorLines.isEmpty() || anchorLines.size() > docLines.size()) {
            return List.of();
        }
        List<Integer> lineStarts = computeLineStartOffsets(doc);
        List<MatchSpan> matches = new ArrayList<>();
        for (int i = 0; i <= docLines.size() - anchorLines.size(); i++) {
            boolean allEqual = true;
            for (int j = 0; j < anchorLines.size(); j++) {
                if (!docLines.get(i + j).trim().equals(anchorLines.get(j).trim())) {
                    allEqual = false;
                    break;
                }
            }
            if (allEqual) {
                int startOffset = lineStarts.get(i);
                int lastIdx = i + anchorLines.size() - 1;
                int endOffset = lineStarts.get(lastIdx) + docLines.get(lastIdx).length();
                matches.add(new MatchSpan(startOffset, endOffset, i + 1));
            }
        }
        return matches;
    }

    private static List<Integer> computeLineStartOffsets(String doc) {
        List<Integer> offsets = new ArrayList<>();
        offsets.add(0);
        for (int i = 0; i < doc.length(); i++) {
            if (doc.charAt(i) == '\n') {
                offsets.add(i + 1);
            }
        }
        return offsets;
    }

    private static int lineAtOffset(String doc, int offset) {
        int line = 1;
        for (int i = 0; i < offset && i < doc.length(); i++) {
            if (doc.charAt(i) == '\n') line++;
        }
        return line;
    }

    private static String closestLineHint(String doc, String anchor) {
        List<String> docLines = splitLines(doc);
        String needle = anchor.trim();
        if (docLines.isEmpty() || needle.isEmpty()) return "";
        String probe = needle.length() > 16 ? needle.substring(0, 16) : needle;
        int bestLine = -1;
        int bestScore = 0;
        for (int i = 0; i < docLines.size(); i++) {
            String candidate = docLines.get(i);
            int score = commonCharOverlap(probe, candidate);
            if (score > bestScore) {
                bestScore = score;
                bestLine = i + 1;
            }
        }
        if (bestLine > 0 && bestScore >= Math.min(4, probe.length())) {
            String excerpt = docLines.get(bestLine - 1);
            if (excerpt.length() > 80) excerpt = excerpt.substring(0, 80) + "...";
            return " 最接近位置在第 " + bestLine + " 行：「" + excerpt + "」";
        }
        return "";
    }

    private static int commonCharOverlap(String a, String b) {
        int hits = 0;
        for (int i = 0; i < a.length(); i++) {
            if (b.indexOf(a.charAt(i)) >= 0) hits++;
        }
        return hits;
    }

    public static DiffResult computeDiff(String label, String beforeRaw, String afterRaw) {
        String before = normalizeLineEndings(beforeRaw);
        String after = normalizeLineEndings(afterRaw);
        List<String> oldLines = splitLines(before);
        List<String> newLines = splitLines(after);

        if (before.equals(after)) {
            return new DiffResult("", 0, 0, before.length(), after.length());
        }

        // Compute LCS DP table on line sequences (prose chapters are typically dozens to hundreds of lines).
        int m = oldLines.size();
        int n = newLines.size();
        if ((long) m * n > 4_000_000L) {
            // Fallback for pathological huge files: single whole-block hunk
            StringBuilder fallback = new StringBuilder("--- ").append(label).append("\n+++ ").append(label)
                    .append("\n@@ -1,").append(m).append(" +1,").append(n).append(" @@\n");
            oldLines.forEach(l -> fallback.append("-").append(l).append('\n'));
            newLines.forEach(l -> fallback.append("+").append(l).append('\n'));
            return new DiffResult(fallback.toString().trim(), n, m, before.length(), after.length());
        }

        int[][] dp = new int[m + 1][n + 1];
        for (int i = m - 1; i >= 0; i--) {
            for (int j = n - 1; j >= 0; j--) {
                if (oldLines.get(i).equals(newLines.get(j))) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        record Op(char kind, int oldLine, int newLine, String text) {}
        List<Op> ops = new ArrayList<>();
        int i = 0, j = 0;
        int added = 0, removed = 0;
        while (i < m && j < n) {
            if (oldLines.get(i).equals(newLines.get(j))) {
                ops.add(new Op(' ', i + 1, j + 1, oldLines.get(i)));
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                ops.add(new Op('-', i + 1, j + 1, oldLines.get(i)));
                removed++;
                i++;
            } else {
                ops.add(new Op('+', i + 1, j + 1, newLines.get(j)));
                added++;
                j++;
            }
        }
        while (i < m) {
            ops.add(new Op('-', i + 1, j + 1, oldLines.get(i)));
            removed++;
            i++;
        }
        while (j < n) {
            ops.add(new Op('+', i + 1, j + 1, newLines.get(j)));
            added++;
            j++;
        }

        // Emit compact unified hunks with context
        StringBuilder diff = new StringBuilder();
        diff.append("--- ").append(label).append("\n+++ ").append(label).append('\n');

        int idx = 0;
        while (idx < ops.size()) {
            while (idx < ops.size() && ops.get(idx).kind() == ' ') idx++;
            if (idx >= ops.size()) break;
            int hunkStart = Math.max(0, idx - DIFF_CONTEXT_LINES);
            int lastChange = idx;
            int scan = idx;
            while (scan < ops.size()) {
                if (ops.get(scan).kind() != ' ') {
                    lastChange = scan;
                } else if (scan - lastChange > DIFF_CONTEXT_LINES * 2) {
                    break;
                }
                scan++;
            }
            int hunkEnd = Math.min(ops.size(), lastChange + DIFF_CONTEXT_LINES + 1);
            int oldStart = ops.get(hunkStart).oldLine();
            int newStart = ops.get(hunkStart).newLine();
            int oldCount = 0;
            int newCount = 0;
            StringBuilder body = new StringBuilder();
            for (int k = hunkStart; k < hunkEnd; k++) {
                Op op = ops.get(k);
                body.append(op.kind()).append(op.text()).append('\n');
                if (op.kind() == ' ' || op.kind() == '-') oldCount++;
                if (op.kind() == ' ' || op.kind() == '+') newCount++;
            }
            diff.append("@@ -").append(oldStart).append(',').append(oldCount)
                    .append(" +").append(newStart).append(',').append(newCount).append(" @@\n")
                    .append(body);
            idx = hunkEnd;
        }

        return new DiffResult(diff.toString().trim(), added, removed, before.length(), after.length());
    }

    public record SearchMatch(int lineNumber, String lineText, String snippet) {}

    public static List<SearchMatch> search(String rawContent, String query, boolean regex, int maxMatches) {
        if (rawContent == null || rawContent.isEmpty() || query == null || query.isBlank()) {
            return List.of();
        }
        List<String> lines = splitLines(rawContent);
        List<SearchMatch> hits = new ArrayList<>();
        Pattern pattern = regex ? Pattern.compile(query, Pattern.CASE_INSENSITIVE) : null;
        String lowerQuery = query.toLowerCase();

        for (int i = 0; i < lines.size() && hits.size() < maxMatches; i++) {
            String line = lines.get(i);
            boolean matched = pattern != null
                    ? pattern.matcher(line).find()
                    : line.toLowerCase().contains(lowerQuery);
            if (matched) {
                String snippet = buildSnippet(lines, i);
                hits.add(new SearchMatch(i + 1, line, snippet));
            }
        }
        return hits;
    }

    private static String buildSnippet(List<String> lines, int lineIndex) {
        String line = lines.get(lineIndex);
        if (line.length() <= 180) return line;
        return line.substring(0, 180) + "...";
    }
}
