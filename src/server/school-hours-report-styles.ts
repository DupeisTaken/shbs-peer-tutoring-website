/** Native report pages mirror the Management primitives without mounting its
 * authenticated shell, scripts or private data providers. Keep these values in
 * step with globals.css; shared mail rendering retains its own compatibility CSS. */
export const publicSchoolHoursReportStyles = `
@font-face {
  font-family: "Report Geist";
  src: url("/report-assets/geist-sans.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}
:root {
  --slate-50: oklch(98.4% 0.003 247.858);
  --slate-100: oklch(96.8% 0.007 247.896);
  --slate-200: oklch(92.9% 0.013 255.508);
  --slate-300: oklch(86.9% 0.022 252.894);
  --slate-500: oklch(55.4% 0.046 257.417);
  --slate-600: oklch(44.6% 0.043 257.281);
  --slate-700: oklch(37.2% 0.044 257.287);
  --slate-900: oklch(20.8% 0.042 265.755);
  --accent-50: oklch(96.2% 0.018 272.314);
  --accent-100: oklch(93% 0.034 272.788);
  --accent-200: oklch(87% 0.065 274.039);
  --accent-500: oklch(58.5% 0.233 277.117);
  --accent-600: oklch(51.1% 0.262 276.966);
  --accent-700: oklch(45.7% 0.24 277.023);
  --accent-800: oklch(39.8% 0.195 277.366);
}
* { box-sizing: border-box; }
html { color-scheme: light; }
body {
  margin: 0;
  background: var(--slate-50);
  color: var(--slate-900);
  font: 14px/1.55 "Report Geist", ui-sans-serif, system-ui, sans-serif,
    "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
  -webkit-font-smoothing: antialiased;
}
main {
  display: grid;
  gap: 24px;
  width: 100%;
  max-width: 1024px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: 24px; font-weight: 700; line-height: 1.3; letter-spacing: -.025em; }
h2 { font-size: 18px; font-weight: 600; line-height: 1.45; letter-spacing: -.025em; }
h3 { font-size: 14px; font-weight: 600; line-height: 1.5; }
strong { font-weight: 600; }
a { color: var(--accent-700); }
a:hover { color: var(--accent-800); }
button, input { font: inherit; }
:is(a, button, input, summary, [tabindex]):focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: 2px;
}
.report-page-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.report-page-header > :first-child { min-width: 0; }
.report-actions, .reminder-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.report-eyebrow { margin-bottom: 8px; color: var(--slate-600); font-size: 14px; }
.report-card, .reminder-panel {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--slate-200);
  border-radius: 12px;
  background: white;
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / .05);
}
.report-summary-meta { display: grid; gap: 12px; margin: 0; }
.report-summary-meta dt { color: var(--slate-500); font-size: 14px; }
.report-summary-meta dd { margin: 2px 0 0; }
.report-content { min-width: 0; }
.report-content > :first-child { margin-top: 0; }
.report-content > :last-child { margin-bottom: 0; }
.report-content > p { margin-bottom: 12px; }
/* Legacy renderer emphasis is presentation only; the complete posting guidance
   stays intact while its public surface follows the Management reader. */
.report-content > div[style*="border-left"] {
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  color: var(--slate-700);
}
.button, a.button {
  display: inline-flex;
  min-width: 44px;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--slate-300);
  border-radius: 6px;
  background: white;
  color: var(--slate-700);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}
.button:hover { background: var(--slate-50); color: var(--slate-700); }
.report-page-header a.button {
  min-height: 44px;
  padding: 8px 16px;
  border: 1px solid var(--slate-300);
  border-radius: 6px;
  background: white;
  color: var(--slate-700);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}
.report-page-header a.button:hover { background: var(--slate-50); color: var(--slate-700); }
.button-primary { border-color: var(--accent-600); background: var(--accent-600); color: white; }
.button-primary:hover { border-color: var(--accent-700); background: var(--accent-700); color: white; }
.button-primary:active { background: var(--accent-800); }
.button-danger { color: #b91c1c; }
.button-danger:hover { border-color: #f87171; background: #fef2f2; color: #b91c1c; }
.reminder-panel { overflow-wrap: anywhere; }
.reminder-heading { min-height: 44px; padding: 4px 0; cursor: pointer; font-size: 18px; font-weight: 600; line-height: 1.5; letter-spacing: -.025em; }
.reminder-heading h2 { display: inline; margin: 0; font: inherit; }
.reminder-content { padding-top: 16px; }
.reminder-content > :last-child { margin-bottom: 0; }
.reminder-form { display: grid; gap: 12px; max-width: 480px; }
.reminder-form .reminder-actions { margin-top: 4px; }
.reminder-label { display: block; color: var(--slate-700); font-weight: 500; }
.reminder-input {
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--slate-300);
  border-radius: 6px;
  background: white;
  color: var(--slate-900);
  font-size: 14px;
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / .05);
}
.reminder-input:focus { border-color: var(--accent-500); }
.reminder-help { margin: 0; color: var(--slate-600); font-size: 12px; line-height: 1.6; }
.reminder-content > .reminder-help { margin-top: 16px; }
.reminder-panel > .reminder-help { margin-top: 12px; }
.reminder-privacy { margin: 12px 0 0; color: var(--slate-600); font-size: 12px; line-height: 1.7; }
.reminder-error { margin: 0 0 16px; padding: 12px; border: 1px solid #fecaca; border-radius: 8px; background: #fef2f2; color: #991b1b; }
.reminder-notice { margin: 12px 0 16px; padding: 12px; border: 1px solid var(--slate-200); border-radius: 8px; background: var(--slate-50); color: var(--slate-700); }
.reminder-notice[role="alert"] { border-color: #fecaca; background: #fef2f2; color: #991b1b; }
.reminder-history { margin: 12px 0 0; padding: 0; list-style: none; }
.reminder-history li { padding: 16px 0; border-top: 1px solid var(--slate-200); }
.reminder-history li:last-child { padding-bottom: 0; }
.reminder-history li > p { margin-bottom: 8px; }
.reminder-status { display: inline-flex; margin-top: 4px; padding: 2px 8px; border-radius: 999px; background: var(--slate-100); color: var(--slate-600); font-size: 12px; font-weight: 500; }
.reminder-status[data-status="PENDING"] { background: var(--accent-50); color: var(--accent-700); }
.reminder-status[data-status="SENT"] { background: #dcfce7; color: #15803d; }
.reminder-status[data-status="FAILED"] { background: #fee2e2; color: #b91c1c; }
.reminder-status:is([data-status="SENDING"], [data-status="BLOCKED"]) { background: #fef3c7; color: #92400e; }
.privacy { margin: 0; padding-top: 16px; border-top: 1px solid var(--slate-200); color: var(--slate-600); font-size: 12px; line-height: 1.7; }
th, td { font-variant-numeric: tabular-nums; }
.school-table-scroll { min-width: 0; overflow-x: auto; border: 1px solid var(--slate-200); border-radius: 8px; background: white; }
.school-hours-table { width: 100%; min-width: 700px; table-layout: fixed; border-collapse: collapse; font-size: 14px; line-height: 1.5; }
.school-hours-table caption { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.school-hours-table :is(th, td) { padding: 8px 12px; text-align: right; vertical-align: middle; overflow-wrap: anywhere; word-break: break-word; }
.school-hours-table thead { background: var(--slate-50); }
.school-hours-table thead th { border-bottom: 1px solid var(--slate-200); color: var(--slate-500); font-size: 12px; font-weight: 600; letter-spacing: .025em; text-transform: uppercase; }
.school-hours-table thead th:first-child, .school-hours-table .person-identity { text-align: left; }
.school-hours-table .school-summary > :is(th, td) { border-bottom: 1px solid var(--slate-100); }
.school-summary:hover { background: var(--slate-50); }
.school-summary .person-identity { font-weight: 500; }
.school-account { display: block; margin-top: 3px; color: var(--slate-500); font-size: 12px; font-weight: 400; }
.column-note { display: block; font-size: 11px; font-weight: 400; letter-spacing: 0; text-transform: none; }
.school-hours-table .posting { background: var(--accent-50); color: var(--accent-700); }
.school-summary .posting { font-size: 16px; font-weight: 600; }
/* Change only legacy positive ink. Debit/red inline values retain their meaning. */
.school-summary .posting[style*="#115E59"] { color: var(--accent-700) !important; }
.school-summary .posting .no-posting { color: var(--slate-700); }
.school-hours-table .person-detail-row > td { padding: 0; border-bottom: 1px solid var(--slate-100); }
.person-details { background: white; }
.person-details summary { position: sticky; left: 0; width: min(100%, calc(100vw - 66px)); min-height: 24px; padding: 3px 12px; color: var(--accent-700); font-size: 12px; font-weight: 500; text-align: right; cursor: pointer; list-style-position: inside; }
.person-details summary::marker { font-size: 10px; }
.person-details summary::after { content: ""; display: block; clear: both; }
.person-details summary:hover { color: var(--accent-800); text-decoration: underline; }
.person-details summary:focus-visible { outline: none; text-decoration: underline; text-decoration-thickness: 3px; text-underline-offset: 4px; }
.person-detail-content { position: sticky; left: 0; max-width: min(100%, calc(100vw - 66px)); padding: 8px 12px 16px; font-size: 14px; line-height: 1.65; text-align: left; overflow-wrap: anywhere; }
.person-detail-content p { margin: 0 0 12px; }
.person-detail-content p:last-child { margin-bottom: 0; }
.mobile-row-context { display: none; }
.table-scroll-hint { display: none; color: var(--slate-600); font-size: 12px; line-height: 1.6; }
@media (min-width: 640px) {
  .report-card, .reminder-panel { padding: 20px; }
  .report-summary-meta { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (min-width: 1024px) {
  .button, .reminder-input { min-height: 40px; }
  .report-page-header a.button { min-height: 40px; }
  .reminder-heading { min-height: 32px; }
}
@media (max-width: 1023px) {
  .person-details summary { min-height: 44px; padding: 12px; }
  .report-content > details > summary { min-height: 44px; }
}
@media (max-width: 740px) {
  .table-scroll-hint { display: block; }
  .mobile-row-context { display: block; float: left; max-width: calc(100% - 106px); color: var(--slate-900); text-align: left; font-weight: 400; }
  .mobile-row-context strong { font-weight: 600; }
}
/* data-label is an additive upstream presentation contract. Until it exists,
   keep the complete accessible horizontal table rather than hiding labels. */
@media (max-width: 640px) {
  .school-table-scroll:has(.school-summary td[data-label]) { overflow: visible; border: 0; border-radius: 0; background: transparent; }
  .report-content:has(.school-summary td[data-label]) .table-scroll-hint { display: none; }
  .school-hours-table:has(.school-summary td[data-label]) { display: block; min-width: 0; table-layout: auto; }
  .school-hours-table:has(.school-summary td[data-label]) > :is(colgroup, thead) { display: none; }
  .school-hours-table:has(.school-summary td[data-label]) .person { display: block; margin-bottom: 12px; overflow: hidden; border: 1px solid var(--slate-200); border-radius: 8px; background: white; }
  .school-hours-table:has(.school-summary td[data-label]) .person:last-child { margin-bottom: 0; }
  .school-hours-table:has(.school-summary td[data-label]) .school-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 12px; gap: 4px; }
  .school-hours-table:has(.school-summary td[data-label]) .school-summary > :is(th, td) { display: block; min-width: 0; padding: 12px; border: 0; text-align: left; }
  .school-hours-table:has(.school-summary td[data-label]) .school-summary .person-identity { grid-column: 1 / -1; padding: 4px 4px 8px; }
  .school-hours-table:has(.school-summary td[data-label]) .school-summary td[data-label]::before { display: block; margin-bottom: 4px; color: var(--slate-700); font-size: 12px; font-weight: 400; content: attr(data-label); }
  .school-hours-table:has(.school-summary td[data-label]) .school-summary .person-identity::before { display: none; }
  .school-hours-table:has(.school-summary td[data-label]) .school-summary .posting { border-radius: 6px; font-size: 18px; }
  .school-hours-table:has(.school-summary td[data-label]) .person-detail-row { display: block; }
  .school-hours-table:has(.school-summary td[data-label]) .person-detail-row > td { display: block; width: 100%; border: 0; }
  .school-hours-table:has(.school-summary td[data-label]) .person-details summary { position: static; width: 100%; padding: 12px 16px; }
  .school-hours-table:has(.school-summary td[data-label]) .person-detail-content { position: static; width: 100%; max-width: 100%; padding: 8px 16px 16px; }
  .school-hours-table:has(.school-summary td[data-label]) .mobile-row-context { display: none; }
}
@media print {
  body { background: white; color: black; }
  main { display: block; max-width: none; padding: 0; }
  h1 { font-size: 20pt; }
  #reminder, .report-actions, .button, .privacy, .table-scroll-hint { display: none !important; }
  .report-card { padding: 0; border: 0; border-radius: 0; box-shadow: none; }
  .report-page-header { display: block; margin-bottom: 16px; }
  .school-table-scroll { overflow: visible !important; border: 0; }
  .school-hours-table, .school-hours-table:has(.school-summary td[data-label]) { display: table; min-width: 0; width: 100%; }
  .school-hours-table > colgroup { display: table-column-group !important; }
  .school-hours-table > thead { display: table-header-group !important; }
  .school-hours-table .person { display: table-row-group !important; break-inside: avoid; border: 0 !important; }
  .school-hours-table :is(.school-summary, .person-detail-row) { display: table-row !important; }
  .school-hours-table :is(th, td) { display: table-cell !important; padding: 6px !important; font-size: 9pt; }
  .school-hours-table .person-identity { font-weight: 600; }
  .school-hours-table .school-summary > :not(.person-identity) { text-align: right !important; }
  .school-hours-table .school-summary td[data-label]::before { display: none !important; }
  .school-hours-table .person-detail-row > td { padding: 0 !important; }
  details { display: none; }
  .person-details { display: block; }
  .person-details::details-content { content-visibility: visible; }
  .person-details > summary { display: none !important; }
  .school-hours-table .person-detail-content { display: block; position: static; width: auto; max-width: none; padding: 8px 0 16px !important; font-size: 9pt; }
}
`;
