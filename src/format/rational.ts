/**
 * Rational approximation under a bounded denominator.
 *
 * This is the one piece of arithmetic a fraction format code needs and the
 * rest of the format module does not. `# ??/??` does not mean "write the
 * decimal expansion over a power of ten and cancel": it means "the closest
 * fraction whose denominator has at most two digits", and the two are
 * different questions with different answers. 0.3 under a one-digit bound is
 * `1/3`, which is wrong by 0.0333; the truncation `3/10` is not a candidate at
 * all, because 10 does not fit in one digit.
 *
 * The search is a continued-fraction expansion rather than a scan. The
 * convergents of a continued fraction are exactly the fractions that are
 * closer to the value than any fraction with a smaller denominator, so the
 * last convergent inside the bound is the best approximation among all
 * convergents. That is not quite the answer: between two convergents lie the
 * *semiconvergents*, and one of them can be inside the bound while being
 * closer than the convergent before it. So the expansion runs until a
 * convergent would overflow the bound, and then the best semiconvergent at
 * that step is compared against the convergent before it. One of the two is
 * the answer; `bestRationalUnder` returns whichever is closer.
 *
 * The scan this replaces is a legitimate way to get the same answer and is
 * what the tests use as a reference — it is O(N) per call and the expansion is
 * O(log N), which matters because a format is re-applied on every repaint.
 */

/** A fraction in lowest terms, with a non-negative numerator. */
export interface Rational {
  readonly numerator: number;
  readonly denominator: number;
}

/**
 * The closest fraction to `value` whose denominator is at most `maxDenominator`.
 *
 * `value` must be finite and non-negative; a format applies the sign itself,
 * so the sign never reaches here. The denominator bound must be at least 1.
 *
 * Ties — two fractions exactly the same distance away — go to the smaller
 * denominator, and then to the larger numerator. The second rule only ever
 * settles a half, where rounding up is what the rest of the formatter does.
 */
export function bestRationalUnder(value: number, maxDenominator: number): Rational {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("a rational approximation needs a finite, non-negative value");
  }
  if (!Number.isInteger(maxDenominator) || maxDenominator < 1) {
    throw new RangeError("a denominator bound must be a positive whole number");
  }

  // Previous two convergents, as (numerator, denominator) pairs. The seeds are
  // the conventional 1/0 and 0/1, which are not fractions in their own right
  // but make the recurrence below start correctly.
  let prevNum = 0;
  let prevDen = 1;
  let lastNum = 1;
  let lastDen = 0;

  let remainder = value;

  // A continued fraction of a double terminates in at most a few dozen steps
  // once the bound is finite, but a pathological remainder can in principle
  // keep going; the bound check below is what actually ends the loop, and the
  // step cap is a guard against a remainder that never settles.
  for (let step = 0; step < 64; step += 1) {
    const whole = Math.floor(remainder);
    const num = whole * lastNum + prevNum;
    const den = whole * lastDen + prevDen;

    if (den > maxDenominator) {
      // The convergent is out of range. The best semiconvergent at this step
      // takes the largest multiple of the previous convergent that still fits.
      const steps = Math.floor((maxDenominator - prevDen) / lastDen);
      const semiNum = steps * lastNum + prevNum;
      const semiDen = steps * lastDen + prevDen;
      return closer(value, { numerator: semiNum, denominator: semiDen }, {
        numerator: lastNum,
        denominator: lastDen,
      });
    }

    prevNum = lastNum;
    prevDen = lastDen;
    lastNum = num;
    lastDen = den;

    const fraction = remainder - whole;
    if (fraction === 0) break;

    const next = 1 / fraction;
    // Once the reciprocal is past what a double can hold exactly, the next
    // term is noise rather than information: the convergent in hand already
    // agrees with the value to the last bit it has.
    if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER) break;
    remainder = next;
  }

  // `lastDen` is 0 only if the loop never ran, which the step cap prevents.
  return { numerator: lastNum, denominator: lastDen };
}

/**
 * Whichever of two candidates is closer to `value`, under the tie rules above.
 *
 * The comparison is on `|value - p/q|` rather than on the cross-multiplied
 * `|value*q - p|`, which would weight a candidate by its own denominator and
 * is a different question.
 */
function closer(value: number, a: Rational, b: Rational): Rational {
  const errorA = Math.abs(value - a.numerator / a.denominator);
  const errorB = Math.abs(value - b.numerator / b.denominator);
  if (errorA < errorB) return a;
  if (errorB < errorA) return b;
  if (a.denominator !== b.denominator) {
    return a.denominator < b.denominator ? a : b;
  }
  return a.numerator >= b.numerator ? a : b;
}

/**
 * The nearest multiple of `1/denominator`, as a fraction over that denominator.
 *
 * This is the other shape a fraction code can take: `# ?/8` asks for eighths
 * whether or not something closer exists under a bound, so there is nothing to
 * search. The numerator is not reduced — `4/8` stays `4/8`, because the format
 * asked for eighths and reducing it would answer a question nobody asked.
 */
export function nearestMultiple(value: number, denominator: number): Rational {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("a rational approximation needs a finite, non-negative value");
  }
  if (!Number.isInteger(denominator) || denominator < 1) {
    throw new RangeError("a fixed denominator must be a positive whole number");
  }
  return { numerator: Math.round(value * denominator), denominator };
}
