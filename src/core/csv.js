// CSV 解析（对应 Godot 版 data_loader.gd 的 _read_table 语义）
// - 跳过 UTF-8 BOM；第一行为表头
// - 列数不等于表头列数的行：仅一个空单元格（空行）则静默跳过，否则告警跳过
// - 支持引号包裹字段（含逗号/换行），CRLF 兼容

export function parseCsvTable(text, warnings = null) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  const pushField = () => { row.push(field); field = ""; };
  const pushRow = () => { rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushField();
      pushRow();
    } else field += c;
  }
  if (field !== "" || row.length > 0) { pushField(); pushRow(); }
  if (rows.length === 0) return [];
  const header = rows[0];
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (cells.length !== header.length) {
      if (cells.length === 1 && cells[0].trim() === "") continue; // 空行
      if (cells.every((c) => c.trim() === "")) continue;
      if (warnings) warnings.push(`第 ${r + 1} 行列数 ${cells.length} 与表头 ${header.length} 不符，已跳过`);
      continue;
    }
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cells[c];
    out.push(obj);
  }
  return out;
}

// Godot int() 语义：非法归 0
export function toInt(v) {
  const n = parseInt(String(v).trim(), 10);
  return Number.isNaN(n) ? 0 : n;
}

export function toFloat(v) {
  const n = parseFloat(String(v).trim());
  return Number.isNaN(n) ? 0 : n;
}

// 分号分隔列表
export function parseStringList(raw) {
  if (!raw) return [];
  return String(raw).split(";").map((s) => s.trim()).filter((s) => s !== "");
}

// 羁绊格式："目标id|羁绊名;目标id|羁绊名"
export function parseBonds(raw) {
  return parseStringList(raw).map((entry) => {
    const idx = entry.indexOf("|");
    if (idx < 0) return { target: entry, name: "" };
    return { target: entry.slice(0, idx), name: entry.slice(idx + 1) };
  });
}
