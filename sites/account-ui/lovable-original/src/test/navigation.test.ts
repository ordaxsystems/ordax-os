import { describe, expect, it } from "bun:test";
import { accountSectionFromUrl } from "@/lib/account/navigation";
import { sections } from "@/lib/account/model";

describe("canonical OrdaX account URL navigation", () => {
  it("resolves the base route with and without trailing slash", () => {
    expect(accountSectionFromUrl("/conta")).toBe("/");
    expect(accountSectionFromUrl("/conta/")).toBe("/");
  });

  it("maps every declared section to the same canonical path", () => {
    for (const section of sections) {
      const url = section.path === "/" ? "/conta/" : `/conta${section.path}`;
      expect(accountSectionFromUrl(url)).toBe(section.path);
      expect(accountSectionFromUrl(`${url}/`)).toBe(section.path);
    }
  });

  it("does not mark an unknown or adjacent route active", () => {
    expect(accountSectionFromUrl("/conta/inexistente")).toBe("/");
    expect(accountSectionFromUrl("/contabilidade/seguranca")).toBe("/");
    expect(accountSectionFromUrl("/login/")).toBe("/");
  });
});
