/**
 * Decimal rounding for display.
 *
 * Rounding a binary float with `toFixed` gives the wrong answer often enough
 * to matter: `(1.005).toFixed(2)` is `"1.00"`, because 1.005 is really
 * 1.00499999999999989... in binary. Spreadsheets do not show that. They round
 * the *decimal* the user believes they have, which in practice means rounding
 * the 15-significant-digit representation — the precision at which a double
 * round-trips through a decimal string unambiguously.
 *
 * So the value is first pulled apart into an exact 15-digit decimal via
 * `toExponential`, and rounding happens on those digits, half away from zero.
 */

/** The absolute value as 15 significant decimal digits and a power of ten. */
interface Decimal {
  /** Significant digits, most significant first. Always 15 characters. */
  readonly digits: string;
  /** The value is `digits` read as an integer, times `10 ** exponent`. */
  readonly exponent: number;
}

const SIGNIFICANT = 15;

function decompose(abs: number): Decimal {
  // `toExponential(14)` yields exactly 15 significant digits: one before the
  // point and fourteen after, in every case including zero.
  const text = abs.toExponential(SIGNIFICANT - 1);
  const e = text.indexOf("e");
  const mantissa = text.slice(0, e).replace(".", "");
  const power = Number(text.slice(e + 1));
  return { digits: mantissa, exponent: power - (SIGNIFICANT - 1) };
}

/**
 * Round a non-negative number to `places` decimal places.
 *
 * Returns the integer and fractional digit strings, the fraction padded to
 * exactly `places` characters. Trailing-zero suppression is the caller's job,
 * because whether a trailing zero prints depends on the format's placeholders.
 */
export function roundToPlaces(
  abs: number,
  places: number,
): { readonly int: string; readonly frac: string } {
  if (!Number.isFinite(abs)) {
    return { int: "0", frac: "0".repeat(places) };
  }

  const { digits, exponent } = decompose(abs);
  // Shifting by `places` decimal places puts the rounding boundary at the
  // units position, so the whole job becomes "round this digit string to an
  // integer".
  const shift = exponent + places;

  let rounded: string;
  if (shift >= 0) {
    rounded = digits + "0".repeat(shift);
  } else {
    const keep = digits.length + shift;
    if (keep <= 0) {
      // Everything is to the right of the boundary. The result is 0 or 1
      // depending on whether the first dropped digit rounds up, and that only
      // happens when the boundary falls exactly at the leading digit.
      const roundsUp = keep === 0 && digits.charCodeAt(0) >= 53; // '5'
      rounded = roundsUp ? "1" : "0";
    } else {
      const head = digits.slice(0, keep);
      const roundsUp = digits.charCodeAt(keep) >= 53; // '5'
      rounded = roundsUp ? increment(head) : head;
    }
  }

  rounded = rounded.replace(/^0+(?=\d)/, "");

  if (places === 0) {
    return { int: rounded, frac: "" };
  }
  const padded = rounded.padStart(places + 1, "0");
  return {
    int: padded.slice(0, padded.length - places),
    frac: padded.slice(padded.length - places),
  };
}

/** Add one to a decimal digit string, growing it on carry out of the top. */
function increment(digits: string): string {
  const out = digits.split("");
  let i = out.length - 1;
  while (i >= 0) {
    if (out[i] === "9") {
      out[i] = "0";
      i -= 1;
      continue;
    }
    out[i] = String.fromCharCode(out[i]!.charCodeAt(0) + 1);
    return out.join("");
  }
  return "1" + out.join("");
}

/**
 * The base-ten exponent of a non-zero number, from its decimal expansion.
 *
 * `Math.floor(Math.log10(x))` is off by one for values like 1000 whose
 * logarithm lands a hair below the integer, which shows up as `1.00E+02` for
 * a thousand. Reading the exponent back out of the decimal form cannot.
 */
export function base10Exponent(abs: number): number {
  if (abs === 0 || !Number.isFinite(abs)) return 0;
  const { exponent } = decompose(abs);
  return exponent + SIGNIFICANT - 1;
}
