import { render } from "@testing-library/react";
import { MatrixCell } from "./MatrixCell";

describe("MatrixCell (L3.2)", () => {
  it("L3.2 score cell renders avgScore and a colour-band attribute", () => {
    const { container, getByText } = render(
      <MatrixCell cell={{ kind: "score", avgScore: 92, sessionCount: 2 }} onClick={() => {}} />,
    );
    expect(getByText("92")).toBeInTheDocument();
    const banded = container.querySelector("[data-q]");
    expect(banded).not.toBeNull();
    // high score -> top band
    expect(banded?.getAttribute("data-q")).toBe("elite");
  });

  it("L3.2 score cell is a clickable button wired to onClick", () => {
    const clicks: number[] = [];
    const { container } = render(
      <MatrixCell cell={{ kind: "score", avgScore: 70, sessionCount: 1 }} onClick={() => clicks.push(1)} />,
    );
    const btn = container.querySelector("button");
    expect(btn).not.toBeNull();
    (btn as HTMLButtonElement).click();
    expect(clicks).toEqual([1]);
    expect(btn?.getAttribute("data-q")).toBe("good");
  });

  it("L3.2 sold cell renders 'sold' and is not a button", () => {
    const { container, getByText } = render(<MatrixCell cell={{ kind: "sold" }} />);
    expect(getByText("sold")).toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".matrix-cell--sold")).not.toBeNull();
  });

  it("L3.2 empty cell renders an em dash and is not a button", () => {
    const { container, getByText } = render(<MatrixCell cell={{ kind: "empty" }} />);
    expect(getByText("—")).toBeInTheDocument();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".matrix-cell--empty")).not.toBeNull();
  });
});
