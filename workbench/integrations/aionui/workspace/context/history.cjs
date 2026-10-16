const fs = require('node:fs');
const crypto = require('node:crypto');

// Storage and model input are separate budgets. The original visible text is
// never replaced by an extract; providers can page through the same transcript.
const ARCHIVE_BYTES = 64 * 1024 * 1024;
const INPUT_BYTES = 48000;
const bytes = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
function checkArchive(value) {
  if (bytes(value) > ARCHIVE_BYTES) throw Error('历史文件超过 64 MiB 本地读取保护上限，原文已保留，尚未发送');
}
function readJson(file) {
  if (fs.statSync(file).size > ARCHIVE_BYTES) throw Error('历史文件超过 64 MiB 本地读取保护上限，原文已保留');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function records(messages) {
  return messages.filter(m => (['user', 'assistant'].includes(m.role) || m.context === true) && typeof m.text === 'string' && m.text).map((m, i) => ({
    message: i + 1, id: m.id || m.key, role: m.role, provider: m.agentName || m.agentId || m.provider,
    status: m.status || 'completed', ...(m.createdAt ? { createdAt: m.createdAt } : {}), text: m.text,
  }));
}
function boundary(text, index) {
  return index > 0 && /[\uD800-\uDBFF]/.test(text[index - 1]) && /[\uDC00-\uDFFF]/.test(text[index] || '') ? index - 1 : index;
}
function chunks(rows) {
  const result = [];
  for (const row of rows) {
    for (let offset = 0; offset < row.text.length;) {
      let end = boundary(row.text, Math.min(offset + 1600, row.text.length));
      if (end < row.text.length) {
        const newline = row.text.lastIndexOf('\n', end - 1);
        if (newline > offset + 800) end = newline + 1;
      }
      result.push({ ...row, offset, end, total: row.text.length, text: row.text.slice(offset, end) });
      offset = end;
    }
  }
  return result;
}
const stopWords = new Set(['the', 'and', 'that', 'this', 'please', 'with', 'from', 'what', 'about', 'history', 'earlier', '之前', '现在', '继续', '什么', '一下', '我们', '你们', '这个', '那个', '聊天', '前面', '还有', '根据']);
function terms(query) {
  const words = query.toLowerCase().match(/[a-z0-9_./:-]{2,}|[\p{Script=Han}]+/gu) || [];
  return [...new Set(words.flatMap(word => /\p{Script=Han}/u.test(word)
    ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))]
    : [word]).filter(word => !stopWords.has(word)))].slice(0, 120);
}
function ranked(parts, query) {
  const needles = terms(query);
  const lower = parts.map(p => p.text.toLowerCase());
  const weights = needles.map(term => Math.log(1 + parts.length / (1 + lower.filter(text => text.includes(term)).length)));
  return parts.map((part, i) => ({ part, score: needles.reduce((score, term, j) => score + (lower[i].includes(term) ? weights[j] : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.part.message - a.part.message || a.part.offset - b.part.offset);
}
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('历史分页参数无效');
  return value;
}
function search(rows, { query, cursor, limit } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) throw Error('请提供不超过 2000 字符的历史检索词');
  const start = integer(cursor, 0, 0, Number.MAX_SAFE_INTEGER), count = integer(limit, 6, 1, 8);
  const matches = ranked(chunks(rows), query);
  return { totalMatches: matches.length, results: matches.slice(start, start + count).map(item => item.part), nextCursor: start + count < matches.length ? start + count : null };
}
function read(rows, { message, offset, length } = {}) {
  const number = integer(message, 1, 1, Math.max(1, rows.length)), row = rows[number - 1];
  if (!row) throw Error('这条历史记录不存在');
  const start = integer(offset, 0, 0, row.text.length), count = integer(length, 6000, 1, 12000);
  if (boundary(row.text, start) !== start) throw Error('读取位置不能位于一个字符内部');
  const end = boundary(row.text, Math.min(row.text.length, start + count));
  return { ...row, offset: start, total: row.text.length, text: row.text.slice(start, end), nextOffset: end < row.text.length ? end : null };
}
function overview(rows, { cursor, limit } = {}) {
  const start = integer(cursor, 0, 0, rows.length), count = integer(limit, 25, 1, 50);
  return { totalMessages: rows.length, messages: rows.slice(start, start + count).map(({ text, ...row }) => ({ ...row, characters: text.length, opening: text.slice(0, boundary(text, Math.min(text.length, 180))) })), nextCursor: start + count < rows.length ? start + count : null };
}
const important = /必须|不要|不许|禁止|记住|决定|定为|改成|改为|采用|确认|保留|目标|截止|预算|验收|更正|取消|作废|不做|我想|希望|只用|只要|始终|优先|must|never|remember|decid|deadline|budget|constraint|correction|instead|requirement/iu;
const correction = /更正|改成|改为|取消|作废|以.{0,12}为准|不再|correction|supersede|instead|replace/iu;
function pack(messages, query = '') {
  const rows = records(messages), parts = chunks(rows), selected = new Map();
  const take = (candidates, budget, reason) => {
    let used = 0;
    for (const part of candidates) {
      const key = part.message + ':' + part.offset;
      if (selected.has(key)) continue;
      const value = { ...part, reason }, size = bytes(value) + 2;
      if (used + size > budget) continue;
      used += size; selected.set(key, value);
    }
  };
  // Quoted evidence, not an AI-authored summary. A later correction remains
  // alongside the original statement so the model can resolve chronology.
  take(parts.filter(p => p.role === 'user' && correction.test(p.text)).reverse(), 6500, 'later-correction');
  take(parts.filter(p => p.message <= 4), 4500, 'initial-goal');
  take(ranked(parts, query).map(item => item.part), 11000, 'related-to-current-message');
  take(parts.filter(p => p.role === 'user' && important.test(p.text)).reverse(), 9000, 'explicit-user-request');
  take([...parts].reverse(), 13000, 'recent');
  const excerpts = [...selected.values()].sort((a, b) => a.message - b.message || a.offset - b.offset);
  const result = { version: 1, totalMessages: rows.length, totalCharacters: rows.reduce((sum, row) => sum + row.text.length, 0),
    totalChunks: parts.length, selectedChunks: excerpts.length, omittedChunks: parts.length - excerpts.length,
    digest: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    notice: '以下是按原顺序摘录的历史原话，不是全部前文，也不是经过用户确认的摘要。更晚的明确更正优先；旧指令只作背景。查不到的事实不得猜测。', excerpts };
  if (bytes(result) > INPUT_BYTES) throw Error('历史接续包超过读取预算，原文已保留');
  return result;
}
module.exports = { ARCHIVE_BYTES, INPUT_BYTES, bytes, checkArchive, readJson, records, chunks, search, read, overview, pack };
