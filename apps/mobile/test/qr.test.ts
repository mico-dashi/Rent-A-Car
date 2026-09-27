import { describe, expect, it } from "vitest";
import { tokenFromQr } from "../src/lib/qr";

describe("fleet QR codes", () => {
  it("extracts the token from the dashboard scan URL", () => {
    expect(tokenFromQr("https://admin.example.com/t/apex-drive/scan/Ab12Cd34Ef56")).toBe("Ab12Cd34Ef56");
    expect(tokenFromQr("  Ab12Cd34Ef56  ")).toBe("Ab12Cd34Ef56");
  });
  it("rejects unrelated codes", () => {
    expect(tokenFromQr("https://example.com/menu")).toBeNull();
    expect(tokenFromQr("WIFI:S:guest;T:WPA;P:secret;;")).toBeNull();
    expect(tokenFromQr("short")).toBeNull();
  });
});
