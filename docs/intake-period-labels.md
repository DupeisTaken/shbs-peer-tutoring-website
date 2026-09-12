# Intake period labels

The request form, opening countdown, email-link review and confirmation, and tutee portal use the applied **Quarter System** setting. With it enabled, a period appears as `Quarter · 2026–27 Q3`; with it disabled, the same stored Q3 appears as `Semester · 2026–27 S2`. Q1 and Q2 belong to S1; Q3 and Q4 belong to S2.

Staged feature changes do not affect these labels until the program refresh applies them. Confirmation uses the request's original intake record, rather than whichever intake is currently active. These are display changes: the survey-first enrollment flow, ownership checks, queue priority, seven-day verification deadline, and stored quarter boundaries are unchanged.

`getPeriodDisplay` in `src/lib/period.ts` centralizes display conversion. Its unit tests cover all four quarters in both modes. The survey tests check the applied feature value and original intake; browser component tests cover labels before and after confirmation.
