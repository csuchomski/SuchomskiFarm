import { describe, expect, it } from "vitest";
import { csvField, exportFilename, toCsv, type Column } from "./grazing-export";

describe("csvField", () => {
  it("leaves an ordinary value alone", () => {
    expect(csvField("Paddock 3")).toBe("Paddock 3");
    expect(csvField(1.97)).toBe("1.97");
  });

  it("is empty for nothing, rather than the word null", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    expect(csvField(0)).toBe("0"); // and zero is a value, not nothing
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvField("wet, pugging")).toBe('"wet, pugging"');
    expect(csvField('he said "move them"')).toBe('"he said ""move them"""');
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  describe("formula injection", () => {
    // These files get opened in Excel and Sheets, where a leading =, +, -, @
    // or control character is a formula. A note somebody pasted should not
    // execute when a conservationist opens the export.
    it("defuses every leading character a spreadsheet treats as a formula", () => {
      expect(csvField("=1+1")).toBe("'=1+1");
      expect(csvField("+44 7700 900000")).toBe("'+44 7700 900000");
      expect(csvField("-5")).toBe("'-5");
      expect(csvField("@SUM(A1)")).toBe("'@SUM(A1)");
      // A tab needs no quoting under RFC 4180 — only comma, quote, CR and
      // LF do — so the apostrophe alone is what defuses this one.
      expect(csvField("\tstart")).toBe("'\tstart");
    });

    it("defuses the real-world case, which arrives with a comma too", () => {
      expect(csvField('=HYPERLINK("http://x","click")')).toBe(
        `"'=HYPERLINK(""http://x"",""click"")"`,
      );
    });

    it("does not mangle a negative number that was meant as text", () => {
      // The apostrophe is stripped on display, so the field still reads -5.
      expect(csvField(-5)).toBe("'-5");
    });

    it("leaves a value alone when the dangerous character is not first", () => {
      expect(csvField("Paddock 3 = wet")).toBe("Paddock 3 = wet");
    });
  });
});

describe("toCsv", () => {
  interface Row {
    name: string;
    acres: number | null;
    note: string | null;
  }

  const columns: Column<Row>[] = [
    { key: "name", label: "Paddock", value: (r) => r.name },
    { key: "acres", label: "Acres", value: (r) => r.acres },
    { key: "note", label: "Note", value: (r) => r.note },
  ];

  it("writes a header and a row per record, CRLF as the spec says", () => {
    const csv = toCsv<Row>(
      [
        { name: "Paddock 3", acres: 1.97, note: null },
        { name: "Paddock 4", acres: 2.255, note: "wet, low corner" },
      ],
      columns,
    );
    expect(csv).toBe(
      'Paddock,Acres,Note\r\nPaddock 3,1.97,\r\nPaddock 4,2.255,"wet, low corner"',
    );
  });

  it("writes just the header when there is nothing to say", () => {
    expect(toCsv<Row>([], columns)).toBe("Paddock,Acres,Note");
  });
});

describe("exportFilename", () => {
  it("names the thing and the day, so it is findable in a month", () => {
    expect(exportFilename("events", "2026-08-13T12:00:00.000Z")).toBe("grazing-events-2026-08-13.csv");
  });
});
