import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { preferences } from "../../../preferences/declarations";
import { clearPreference, readPreference } from "../../../preferences/store";
import { RateButton } from "../RateButton";
import { rateFor, setProjectRate } from "../rate";

afterEach(() => clearPreference(preferences.speechRateByProject));

describe("RateButton", () => {
  it("the rate button shows the speed and cycles presets", () => {
    render(<RateButton project="p" />);
    const button = screen.getByTestId("speech-bar-rate-p");
    expect(button).toHaveTextContent("1.0×");
    expect(button.getAttribute("aria-label")).toMatch(/1\.0×/);

    fireEvent.click(button);
    expect(rateFor("p")).toBe(1.2);
    expect(readPreference(preferences.speechRateByProject)).toEqual({ p: 1.2 });
    expect(button).toHaveTextContent("1.2×");
    expect(button.getAttribute("aria-label")).toMatch(/1\.2×/);
  });

  it("follows a rate set elsewhere", () => {
    render(<RateButton project="p" />);
    act(() => setProjectRate("p", 1.3));
    expect(screen.getByTestId("speech-bar-rate-p")).toHaveTextContent("1.3×");
  });
});
