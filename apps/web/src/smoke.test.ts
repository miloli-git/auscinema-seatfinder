// #40 harness smoke test — proves vitest runs under jsdom. Kept as a trivial guard.
describe("vitest harness", () => {
  it("runs a trivial assertion", () => {
    expect(1 + 1).toBe(2);
  });

  it("has a jsdom document", () => {
    expect(typeof document).toBe("object");
  });
});
