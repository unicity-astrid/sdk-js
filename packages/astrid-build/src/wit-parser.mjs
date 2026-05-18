/**
 * Minimal WIT parser sufficient for the wit_events codegen step.
 *
 * Mirrors the subset the Rust `astrid_sdk_macros::wit_events!` macro
 * handles: records, enums, variants, flags. Skips resource types,
 * functions, and use/import statements (codegen doesn't emit code for
 * those — they're for the WIT-to-binding layer ComponentizeJS owns).
 *
 * Input: WIT file content (string).
 * Output: an AST suitable for the codegen step to walk.
 */

const BUILTIN_TYPES = new Set([
  "bool",
  "u8", "u16", "u32", "u64",
  "s8", "s16", "s32", "s64",
  "f32", "f64",
  "char",
  "string",
]);

/** Parse WIT source. Returns `{ pkg, interfaces }`. */
export function parseWit(source, filename = "<input>") {
  const tokens = tokenize(source);
  const parser = new Parser(tokens, filename);
  return parser.parseFile();
}

function tokenize(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  let pendingDoc = "";

  while (i < source.length) {
    const ch = source[i];

    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }

    // Doc comment: /// ...
    if (ch === "/" && source[i + 1] === "/" && source[i + 2] === "/") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = source.length;
      const line_doc = source.slice(i + 3, end).replace(/^ /, "");
      pendingDoc = pendingDoc === "" ? line_doc : pendingDoc + "\n" + line_doc;
      i = end;
      continue;
    }
    // Block comment: /* ... */
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) throw new Error(`Unterminated block comment at line ${line}`);
      const block = source.slice(i + 2, end);
      line += (block.match(/\n/g) ?? []).length;
      i = end + 2;
      continue;
    }
    // Line comment: // ... (non-doc)
    if (ch === "/" && source[i + 1] === "/") {
      let end = source.indexOf("\n", i);
      if (end === -1) end = source.length;
      i = end;
      continue;
    }

    // Punctuation
    const single = "{}<>(),;:.@/=%";
    if (single.indexOf(ch) >= 0) {
      tokens.push({ kind: "punct", value: ch, line, doc: "" });
      i++;
      continue;
    }

    // Quoted identifier (escape with %): %type, %if, etc.
    if (ch === "%") {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_-]/.test(source[j])) j++;
      const id = source.slice(i + 1, j);
      if (id.length === 0) throw new Error(`Empty %-escaped identifier at line ${line}`);
      tokens.push({ kind: "ident", value: id, line, doc: pendingDoc });
      pendingDoc = "";
      i = j;
      continue;
    }

    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_-]/.test(source[j])) j++;
      const id = source.slice(i, j);
      tokens.push({ kind: "ident", value: id, line, doc: pendingDoc });
      pendingDoc = "";
      i = j;
      continue;
    }

    // Number (version segments)
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9]/.test(source[j])) j++;
      tokens.push({ kind: "num", value: source.slice(i, j), line, doc: "" });
      i = j;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at line ${line}`);
  }

  tokens.push({ kind: "eof", value: "", line, doc: "" });
  return tokens;
}

class Parser {
  constructor(tokens, filename) {
    this.tokens = tokens;
    this.filename = filename;
    this.pos = 0;
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  eat() {
    return this.tokens[this.pos++];
  }

  expect(kind, value) {
    const t = this.eat();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error(
        `${this.filename}:${t.line}: expected ${kind}${value !== undefined ? ` '${value}'` : ""} got ${t.kind} '${t.value}'`,
      );
    }
    return t;
  }

  match(kind, value) {
    const t = this.peek();
    return t.kind === kind && (value === undefined || t.value === value);
  }

  parseFile() {
    let pkg;
    const interfaces = [];

    while (!this.match("eof")) {
      if (this.match("ident", "package")) {
        pkg = this.parsePackage();
      } else if (this.match("ident", "interface")) {
        interfaces.push(this.parseInterface());
      } else if (this.match("ident", "world")) {
        // Skip world declarations — we only care about types.
        this.skipBraced();
      } else {
        const t = this.peek();
        throw new Error(`${this.filename}:${t.line}: unexpected token '${t.value}' at file scope`);
      }
    }

    return { pkg, interfaces };
  }

  parsePackage() {
    this.expect("ident", "package");
    const ns = this.expect("ident").value;
    this.expect("punct", ":");
    const name = this.expect("ident").value;
    let version;
    if (this.match("punct", "@")) {
      this.eat();
      version = this.parseVersion();
    }
    this.expect("punct", ";");
    return { ns, name, version };
  }

  parseVersion() {
    const parts = [];
    parts.push(this.expect("num").value);
    while (this.match("punct", ".")) {
      this.eat();
      parts.push(this.expect("num").value);
    }
    return parts.join(".");
  }

  parseInterface() {
    this.expect("ident", "interface");
    const name = this.expect("ident").value;
    this.expect("punct", "{");

    const types = [];
    while (!this.match("punct", "}")) {
      const doc = this.peek().doc;
      if (this.match("ident", "use")) {
        this.skipStatement();
        continue;
      }
      if (this.match("ident", "record")) {
        types.push(this.parseRecord(doc));
        continue;
      }
      if (this.match("ident", "enum")) {
        types.push(this.parseEnum(doc));
        continue;
      }
      if (this.match("ident", "variant")) {
        types.push(this.parseVariant(doc));
        continue;
      }
      if (this.match("ident", "flags")) {
        types.push(this.parseFlags(doc));
        continue;
      }
      if (this.match("ident", "type")) {
        // type alias — record but skip codegen
        this.skipStatement();
        continue;
      }
      // Function declarations: name: func(...) -> ...
      // We only care about types here; skip the rest of the line.
      this.skipStatement();
    }
    this.expect("punct", "}");
    return { name, types };
  }

  parseRecord(doc) {
    this.expect("ident", "record");
    const name = this.expect("ident").value;
    this.expect("punct", "{");
    const fields = [];
    while (!this.match("punct", "}")) {
      const fieldDoc = this.peek().doc;
      const fieldName = this.expect("ident").value;
      this.expect("punct", ":");
      const ty = this.parseType();
      fields.push({ name: fieldName, type: ty, doc: fieldDoc });
      if (this.match("punct", ",")) this.eat();
    }
    this.expect("punct", "}");
    return { kind: "record", name, fields, doc };
  }

  parseEnum(doc) {
    this.expect("ident", "enum");
    const name = this.expect("ident").value;
    this.expect("punct", "{");
    const cases = [];
    while (!this.match("punct", "}")) {
      const caseDoc = this.peek().doc;
      const caseName = this.expect("ident").value;
      cases.push({ name: caseName, doc: caseDoc });
      if (this.match("punct", ",")) this.eat();
    }
    this.expect("punct", "}");
    return { kind: "enum", name, cases, doc };
  }

  parseVariant(doc) {
    this.expect("ident", "variant");
    const name = this.expect("ident").value;
    this.expect("punct", "{");
    const cases = [];
    while (!this.match("punct", "}")) {
      const caseDoc = this.peek().doc;
      const caseName = this.expect("ident").value;
      let ty;
      if (this.match("punct", "(")) {
        this.eat();
        ty = this.parseType();
        this.expect("punct", ")");
      }
      cases.push({ name: caseName, type: ty, doc: caseDoc });
      if (this.match("punct", ",")) this.eat();
    }
    this.expect("punct", "}");
    return { kind: "variant", name, cases, doc };
  }

  parseFlags(doc) {
    this.expect("ident", "flags");
    const name = this.expect("ident").value;
    this.expect("punct", "{");
    const cases = [];
    while (!this.match("punct", "}")) {
      const caseDoc = this.peek().doc;
      const caseName = this.expect("ident").value;
      cases.push({ name: caseName, doc: caseDoc });
      if (this.match("punct", ",")) this.eat();
    }
    this.expect("punct", "}");
    return { kind: "flags", name, cases, doc };
  }

  parseType() {
    const t = this.eat();
    if (t.kind !== "ident") {
      throw new Error(`${this.filename}:${t.line}: expected type, got ${t.kind} '${t.value}'`);
    }
    const name = t.value;
    if (BUILTIN_TYPES.has(name)) {
      return { kind: "builtin", name };
    }
    if (name === "option") {
      this.expect("punct", "<");
      const inner = this.parseType();
      this.expect("punct", ">");
      return { kind: "option", inner };
    }
    if (name === "list") {
      this.expect("punct", "<");
      const inner = this.parseType();
      this.expect("punct", ">");
      return { kind: "list", inner };
    }
    if (name === "tuple") {
      this.expect("punct", "<");
      const elems = [];
      elems.push(this.parseType());
      while (this.match("punct", ",")) {
        this.eat();
        elems.push(this.parseType());
      }
      this.expect("punct", ">");
      return { kind: "tuple", elems };
    }
    if (name === "result") {
      // result<T, E> or result<_, E> or result. Skip for now — events
      // shouldn't have result fields. If we encounter one, decay to `any`.
      if (this.match("punct", "<")) {
        this.skipBraced("<", ">");
      }
      return { kind: "unknown" };
    }
    // Named reference to another record/enum/variant.
    return { kind: "named", name };
  }

  skipStatement() {
    let depth = 0;
    while (!this.match("eof")) {
      const t = this.eat();
      if (t.kind === "punct") {
        if (t.value === "(" || t.value === "<" || t.value === "{") depth++;
        else if (t.value === ")" || t.value === ">" || t.value === "}") {
          if (depth === 0) {
            // A bare closer ends our scan, but we shouldn't consume it
            // unless we opened it. Put it back.
            this.pos--;
            return;
          }
          depth--;
        } else if (t.value === ";" && depth === 0) {
          return;
        }
      }
    }
  }

  skipBraced(open = "{", close = "}") {
    // If the next token is the opener, consume it.
    if (this.match("punct", open)) this.eat();
    let depth = 1;
    while (depth > 0 && !this.match("eof")) {
      const t = this.eat();
      if (t.kind === "punct") {
        if (t.value === open) depth++;
        else if (t.value === close) depth--;
      }
    }
  }
}
