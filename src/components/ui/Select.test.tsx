import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "./Select";

describe("Select native contract", () => {
  it("keeps the real form field, placeholder, groups, values and default selection", () => {
    const html = renderToStaticMarkup(
      <label htmlFor="category">Category
        <Select id="category" name="categoryCode" defaultValue="wallet" required aria-describedby="hint" className="w-full">
          <option value="" disabled>Choose a category</option>
          <optgroup label="Items"><option value="wallet">Wallet</option><option value="phone" disabled>Phone</option></optgroup>
        </Select>
      </label>,
    );
    expect(html).toContain('<select id="category" name="categoryCode" required="" aria-describedby="hint" class="mju-select w-full">');
    expect(html).toContain('<option value="wallet" selected="">Wallet</option>');
    expect(html).toContain('<option value="" disabled="">Choose a category</option>');
    expect(html).toContain('<optgroup label="Items">');
    expect(html).toContain('<option value="phone" disabled="">Phone</option>');
    expect(html).not.toContain('type="hidden"');
    expect(html).not.toContain('<button');
  });

  it("preserves controlled values, disabled, validity and accessible metadata", () => {
    const html = renderToStaticMarkup(<Select value="b" onChange={() => {}} disabled error aria-label="Status" aria-describedby="error"><option value="a">A</option><option value="b">B</option></Select>);
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('aria-describedby="error"');
    expect(html).toContain('<option value="b" selected="">B</option>');
  });

  it("retains the platform opt-out, multiple/listbox fields and the select ref type", () => {
    const ref = createRef<HTMLSelectElement>();
    const html = renderToStaticMarkup(<Select ref={ref} multiple size={4} name="values" defaultValue={["a", "b"]} native aria-invalid="grammar"><option value="a">A</option><option value="b">B</option></Select>);
    expect(html).toContain('multiple="" size="4" name="values"');
    expect(html).toContain('data-native-select=""');
    expect(html).toContain('aria-invalid="grammar"');
    expect(html.match(/selected=""/g)).toHaveLength(2);
  });
});
