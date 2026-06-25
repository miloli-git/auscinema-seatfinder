import { render, fireEvent } from "@testing-library/react";
import { MinScoreControl } from "./MinScoreControl";

describe("MinScoreControl (L3.7)", () => {
  it("L3.7 change fires the re-query handler with the new minScore (one /together call, not a client re-filter)", () => {
    const calls: number[] = [];
    const { getByLabelText } = render(
      <MinScoreControl value={74} onMinScoreChange={(n) => calls.push(n)} />,
    );
    const input = getByLabelText(/min score/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "85" } });
    expect(calls).toEqual([85]);
  });

  it("L3.7 reflects the controlled value", () => {
    const { getByLabelText } = render(
      <MinScoreControl value={60} onMinScoreChange={() => {}} />,
    );
    expect((getByLabelText(/min score/i) as HTMLInputElement).value).toBe("60");
  });
});
