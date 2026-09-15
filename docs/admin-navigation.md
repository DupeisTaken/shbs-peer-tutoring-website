# Admin navigation

Desktop administration uses a viewport-height shell. The header takes its actual height; the sidebar and content each scroll in the remaining space. Wheel/trackpad scrolling stays in the targeted pane. The main region can receive keyboard focus for scrolling.

On small screens, Menu opens a native modal drawer with grouped navigation. Its close control stays above a scrollable list, Escape closes it, and selecting a link closes it. Existing role and optional-module filtering remains enforced.

Workspace switches appear together in the header and at the top of the account submenu: **Enter Tutor Page**, then **Enter Tutee Page**. Tutor entry requires a linked, non-archived tutor; tutee entry remains available to every active signed-in account. The controls wrap on narrow screens and do not prefetch additional workspaces.

Both participant workspaces show **Back to Management** in the header and account submenu for HEAD, ADMIN, COORDINATOR and VIEWER. This navigation does not grant write access to viewers.

Header workspace buttons match the language selector: 32 px at desktop widths
(`lg`, 1024 px and above), with at least 44 px touch targets below that breakpoint.
The project [control-height hierarchy](../AGENTS.md) defines sizing by interface level.

On mobile, the shared workspace header has three levels: brand and language,
then the hamburger menu (management only) opposite theme/notifications/account,
then the workspace switches under a subtle divider. The menu remains a modal drawer
with its accessible name, keyboard dismissal and link-close behavior. Mobile controls
retain 44 px touch targets; desktop stays in one compact row.

Management accounts without a tutor profile can still open the tutee workspace and
return to management. They see no tutor entry link; direct tutor-area access remains
gated. Tutee participation does not require tutor eligibility.
