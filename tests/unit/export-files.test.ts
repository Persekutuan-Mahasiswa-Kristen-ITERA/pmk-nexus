// Export writers (spec F5, A-MD5, MD-10, MD-24, MD-29, MD-37): CSV (hand-written), XLSX, PDF, Asia/Jakarta dates.
import { describe, expect, it } from "vitest";
import { csvField, neutralizeFormula, toCsv, toCsvBytes } from "@/lib/export/csv";
import { attachmentDisposition, jakartaDate, jakartaDateTime } from "@/lib/export/datetime";
import { writeXlsxTable } from "@/lib/export/xlsx";
import { buildMemberExportFile, memberExportFileName } from "@/modules/member-data/server/export-file";
import type { MemberRow } from "@/modules/member-data/types";
import { sharedStrings, unzip } from "../support/zip";

describe("CSV writer: format", () => {
  it("starts with a UTF-8 BOM (bytes EF BB BF) so Excel reads accents", () => {
    const bytes = toCsvBytes(["a"], []);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(toCsv(["a"], []).charCodeAt(0)).toBe(0xfeff);
  });
  it("uses CRLF between lines and ends with CRLF; never a bare LF", () => {
    const text = toCsv(["A", "B"], [["1", "2"], ["3", "4"]]);
    expect(text).toBe("\uFEFFA,B\r\n1,2\r\n3,4\r\n");
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });
  it("RFC 4180 quoting: comma, quote (doubled), CR, LF", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("a\rb")).toBe('"a\rb"');
    expect(csvField("plain")).toBe("plain");
    expect(csvField("  spaces  ")).toBe("  spaces  ");
  });
  it("null is empty, numbers are plain, non-finite numbers are empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(7)).toBe("7");
    expect(csvField(0)).toBe("0");
    expect(csvField(Number.NaN)).toBe("");
    expect(csvField(Number.POSITIVE_INFINITY)).toBe("");
  });
  it("non-ASCII survives as UTF-8", () => {
    const text = new TextDecoder().decode(toCsvBytes(["Nama"], [["Nöl Ñandú 日本"]]));
    expect(text).toContain("Nöl Ñandú 日本");
  });
  it("an empty table is just the header line", () => {
    expect(toCsv(["No", "Nama"], [])).toBe("\uFEFFNo,Nama\r\n");
  });
  it("a very long cell is written whole", () => {
    const long = "x".repeat(100_000);
    expect(csvField(long)).toHaveLength(100_000);
  });
});

describe("CSV writer: formula injection (OWASP): = + - @ TAB CR get an apostrophe prefix", () => {
  const dangerous = ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "=cmd|' /C calc'!A0", "--1", "-A1", "@", "=", "+", "-x"];
  for (const value of dangerous) {
    it(`prefixes ${JSON.stringify(value)}`, () => {
      expect(neutralizeFormula(value)).toBe(`'${value}`);
      expect(csvField(value)).toContain(`'${value.replace(/"/g, '""')}`);
    });
  }
  it("a lone '-' (the 'no value' placeholder) is exempt", () => {
    expect(neutralizeFormula("-")).toBe("-");
    expect(csvField("-")).toBe("-");
  });
  it("safe values are untouched, including a '-' or '=' that is not first", () => {
    for (const value of ["Budi", "a=b", "a-b", "x+y", "x@y", " =1", "'=1", "1=1", "Ñ=1"]) {
      expect(neutralizeFormula(value), value).toBe(value);
    }
  });
  it("the prefixed value is still quoted when it needs quoting", () => {
    expect(csvField('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvField("\r=1")).toBe(`"'\r=1"`);
  });
  it("the header row is neutralized too", () => {
    expect(toCsv(["=evil"], [])).toContain("'=evil");
  });
  it("numbers are never prefixed (a negative number is a number, not a string)", () => {
    expect(csvField(-5)).toBe("-5");
  });
});

describe("Filename and header dates are Asia/Jakarta (UTC+7, no DST)", () => {
  it("rolls over to the next day at 17:00Z", () => {
    expect(jakartaDate(new Date("2026-11-06T16:59:59.999Z"))).toBe("2026-11-06");
    expect(jakartaDate(new Date("2026-11-06T17:00:00.000Z"))).toBe("2026-11-07");
  });
  it("rolls over the year and month", () => {
    expect(jakartaDate(new Date("2026-12-31T17:00:00Z"))).toBe("2027-01-01");
    expect(jakartaDate(new Date("2026-02-28T17:00:00Z"))).toBe("2026-03-01");
    expect(jakartaDate(new Date("2028-02-28T17:00:00Z"))).toBe("2028-02-29");
  });
  it("jakartaDateTime: WIB label, 24 h clock, midnight is 00:00 not 24:00", () => {
    expect(jakartaDateTime(new Date("2026-11-06T16:40:00Z"))).toBe("2026-11-06 23:40 WIB");
    expect(jakartaDateTime(new Date("2026-11-06T17:00:00Z"))).toBe("2026-11-07 00:00 WIB");
    expect(jakartaDateTime(new Date("2026-11-06T00:05:00Z"))).toBe("2026-11-06 07:05 WIB");
  });
  it("memberExportFileName: data-anggota-YYYY-MM-DD.<format>", () => {
    const at = new Date("2026-11-06T17:30:00Z");
    expect(memberExportFileName("xlsx", at)).toBe("data-anggota-2026-11-07.xlsx");
    expect(memberExportFileName("csv", at)).toBe("data-anggota-2026-11-07.csv");
    expect(memberExportFileName("pdf", at)).toBe("data-anggota-2026-11-07.pdf");
  });
  it("attachmentDisposition keeps ASCII only and cannot inject a header", () => {
    expect(attachmentDisposition("data-anggota-2026-11-07.csv")).toBe('attachment; filename="data-anggota-2026-11-07.csv"');
    const nasty = attachmentDisposition('a b"\r\nX-Evil: 1/../é.csv');
    expect(nasty).toMatch(/^attachment; filename="[A-Za-z0-9._-]+"$/);
    expect(nasty).not.toMatch(/[\r\n]/);
  });
});

describe("XLSX: text cells are never formulas (MD-10 safety, D-020)", () => {
  const evil = ["=1+1", "+SUM(1,2)", "-2+3", "@SUM(A1)", "=HYPERLINK(\"http://evil\",\"x\")", "\t=1"];

  async function build() {
    const bytes = await writeXlsxTable({
      sheetName: "Data Anggota",
      metaLines: ["Data Anggota PMK ITERA", "=META()"],
      header: ["No", "Nama Lengkap", "=HDR()"],
      rows: evil.map((v, i) => [i + 1, v, null]),
      columnWidths: [6, 36, 10],
    });
    return unzip(bytes);
  }

  it("is a valid ZIP with the expected parts", async () => {
    const files = await build();
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml"]));
    expect(Object.keys(files).some((n) => /^xl\/worksheets\/sheet1\.xml$/.test(n))).toBe(true);
  });

  it("no cell carries a formula element, and every text cell is a string cell (t=s or inlineStr)", async () => {
    const files = await build();
    const sheet = files["xl/worksheets/sheet1.xml"].toString("utf8");
    expect(sheet).not.toMatch(/<f[ >\/]/);
    const textCells = [...sheet.matchAll(/<c [^>]*t="([^"]+)"[^>]*>/g)].map((m) => m[1]);
    expect(textCells.length).toBeGreaterThan(0);
    for (const t of textCells) expect(["s", "inlineStr"]).toContain(t);
  });

  it("the dangerous strings are stored exactly as given (no apostrophe prefix, not evaluated)", async () => {
    const files = await build();
    const strings = sharedStrings(files);
    for (const v of evil) expect(strings, JSON.stringify(v)).toContain(v);
    expect(strings).toContain("=META()");
    expect(strings).toContain("=HDR()");
  });
});

const rows: MemberRow[] = [
  { rowNo: 1, memberId: "a", fullName: "Alfa Staff", isLecturer: false, isActive: true, unitName: "Logistik", parentUnitName: "Departemen Operasional", positionName: "Staff" },
  { rowNo: 2, memberId: "b", fullName: "Dr. Pembina, M.Si.", isLecturer: true, isActive: true, unitName: null, parentUnitName: null, positionName: null },
  { rowNo: 3, memberId: "c", fullName: "=Evil Name", isLecturer: false, isActive: false, unitName: "BPH PMK ITERA", parentUnitName: null, positionName: "Ketua Umum" },
  { rowNo: 4, memberId: "d", fullName: 'Quote "Q" Name', isLecturer: false, isActive: true, unitName: null, parentUnitName: null, positionName: null },
];
const meta = { periodLabel: "2026/2027", exportedAt: new Date("2026-11-06T17:00:00Z") };

describe("buildMemberExportFile: CSV", () => {
  it("columns, order, values: No, Nama Lengkap, Pembina, Unit, Jabatan, Status", async () => {
    const file = await buildMemberExportFile("csv", rows, meta);
    expect(file.fileName).toBe("data-anggota-2026-11-07.csv");
    expect(file.contentType).toBe("text/csv; charset=utf-8");
    const lines = new TextDecoder().decode(file.bytes).replace(/^\uFEFF/, "").split("\r\n");
    expect(lines[0]).toBe("No,Nama Lengkap,Pembina,Unit,Jabatan,Status");
    expect(lines[1]).toBe("1,Alfa Staff,,Departemen Operasional · Logistik,Staff,Aktif");
    expect(lines[2]).toBe('2,"Dr. Pembina, M.Si.",Ya,-,-,Aktif'); // lecturer: marker, '-' for no assignment (MD-24, R10)
    expect(lines[3]).toBe("3,'=Evil Name,,BPH PMK ITERA,Ketua Umum,Nonaktif");
    expect(lines[4]).toBe('4,"Quote ""Q"" Name",,-,-,Aktif');
    expect(lines[5]).toBe(""); // trailing CRLF
    expect(lines).toHaveLength(6);
  });
  it("one data line per row and nothing else (no title lines in CSV)", async () => {
    const file = await buildMemberExportFile("csv", rows, meta);
    expect(new TextDecoder().decode(file.bytes).trim().split("\r\n")).toHaveLength(rows.length + 1);
  });
  it("empty rows -> header only (empty export is a valid file)", async () => {
    const file = await buildMemberExportFile("csv", [], meta);
    expect(new TextDecoder("utf-8", { ignoreBOM: true }).decode(file.bytes)).toBe("\uFEFFNo,Nama Lengkap,Pembina,Unit,Jabatan,Status\r\n");
  });
  it("never contains personal-data columns", async () => {
    const text = new TextDecoder().decode((await buildMemberExportFile("csv", rows, meta)).bytes).split("\r\n")[0];
    expect(text).not.toMatch(/email|phone|telepon|nim|nip|user_id|access_level|deactivated/i);
  });
});

describe("buildMemberExportFile: XLSX", () => {
  it("content type, name, header, rows, period and export-time lines", async () => {
    const file = await buildMemberExportFile("xlsx", rows, meta);
    expect(file.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(file.fileName).toBe("data-anggota-2026-11-07.xlsx");
    const files = unzip(file.bytes);
    const strings = sharedStrings(files);
    expect(strings).toEqual(
      expect.arrayContaining(["Data Anggota PMK ITERA", "Periode 2026/2027", "Diekspor 2026-11-07 00:00 WIB", "No", "Nama Lengkap", "Pembina", "Unit", "Jabatan", "Status"]),
    );
    expect(strings).toEqual(expect.arrayContaining(["Alfa Staff", "Departemen Operasional · Logistik", "=Evil Name", "Ya", "Nonaktif", "-"]));
    expect(files["xl/worksheets/sheet1.xml"].toString("utf8")).not.toMatch(/<f[ >\/]/);
  });
  it("a missing period label drops the Periode line", async () => {
    const file = await buildMemberExportFile("xlsx", rows, { ...meta, periodLabel: null });
    expect(sharedStrings(unzip(file.bytes)).some((s) => s.startsWith("Periode "))).toBe(false);
  });
});

describe("buildMemberExportFile: PDF", () => {
  it("is a PDF (magic, EOF marker), correct type and name, with and without rows", async () => {
    for (const set of [rows, []]) {
      const file = await buildMemberExportFile("pdf", set, meta);
      expect(file.contentType).toBe("application/pdf");
      expect(file.fileName).toBe("data-anggota-2026-11-07.pdf");
      expect(Buffer.from(file.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
      expect(Buffer.from(file.bytes.subarray(-8)).toString("latin1")).toContain("%%EOF");
    }
  });
  it("a large table (800 rows, long names) builds without error and paginates", async () => {
    const many: MemberRow[] = Array.from({ length: 800 }, (_, i) => ({
      rowNo: i + 1,
      memberId: String(i),
      fullName: `Anggota Dengan Nama Yang Sangat Panjang Sekali ${i} ${"x".repeat(80)}`,
      isLecturer: i % 17 === 0,
      isActive: i % 5 !== 0,
      unitName: i % 3 === 0 ? null : "Logistik",
      parentUnitName: i % 3 === 0 ? null : "Departemen Operasional",
      positionName: i % 3 === 0 ? null : "Staff",
    }));
    const file = await buildMemberExportFile("pdf", many, meta);
    const pages = (Buffer.from(file.bytes).toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;
    expect(pages).toBeGreaterThan(5);
  });
  it("odd names (emoji, Cyrillic, RTL, 5000 chars) never crash the writer", async () => {
    const odd: MemberRow[] = ["😀 Émile", "Иван Петров", "محمد", "x".repeat(5000), ""].map((fullName, i) => ({
      rowNo: i + 1, memberId: String(i), fullName, isLecturer: false, isActive: true, unitName: null, parentUnitName: null, positionName: null,
    }));
    await expect(buildMemberExportFile("pdf", odd, meta)).resolves.toBeTruthy();
    await expect(buildMemberExportFile("xlsx", odd, meta)).resolves.toBeTruthy();
    await expect(buildMemberExportFile("csv", odd, meta)).resolves.toBeTruthy();
  });
});
