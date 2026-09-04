import { amortisationSchedule } from "../src/analysis/amortisation.js";
for (const [rate,nper,pv,fv] of [[0.09/12,360,125000,0],[0.05,10,50000,0],[0,12,6000,0],[0.06/4,20,1000000,-400000]] as const) {
  const s = amortisationSchedule({rate,nper,pv,fv,type:0});
  const last = s.periods[s.periods.length-1]!;
  const first = s.periods[0]!;
  const invariant = s.periods.every(r => Math.abs(r.closing - (r.opening + r.principal)) < 1e-6);
  const payIsParts = s.periods.every(r => Math.abs(r.payment - (r.interest + r.principal)) < 1e-6);
  console.log(`rate=${rate} n=${nper} pv=${pv} fv=${fv} pmt=${s.payment.toFixed(4)} lastClosing=${last.closing} totalPrincipal=${s.totalPrincipal.toFixed(6)} inv=${invariant} parts=${payIsParts} lastPay=${last.payment.toFixed(6)} firstOpening=${first.opening}`);
}
