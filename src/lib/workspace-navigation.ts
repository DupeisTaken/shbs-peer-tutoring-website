import { portalAccess } from "~/lib/portal-access";
import { translationAccess } from "~/lib/translation-access";

export type WorkspaceArea =
  | "management"
  | "tutor"
  | "tutee"
  | "crew"
  | "translations"
  | "home"
  | "help";

export type WorkspaceSwitcherGroup = "workspaces" | "general";

export type WorkspaceSwitcherItem = {
  id: WorkspaceArea;
  href: string;
  label: string;
  group: WorkspaceSwitcherGroup;
};

export type WorkspaceNavAccount = {
  role: string;
  suspendedAt?: Date | null;
  mergedIntoId?: string | null;
  crewStatus?: string | null;
  tutorId?: string | null;
  tutorAccessRevoked?: boolean;
  canTranslate?: boolean;
  schoolDeparture?: {
    reason: string | null;
    observerRevoked: boolean;
    tutorDerived: boolean;
  } | null;
  tutor?: { status: string } | null;
};

export type WorkspaceNavLabels = {
  management: string;
  viewer: string;
  tutor: string;
  tutee: string;
  crew: string;
  translations: string;
  programHome: string;
  helpCenter: string;
};

/**
 * Pure, server-authoritative resolver for the signed-in workspace switcher.
 *
 * Security & visibility invariants:
 * - Only destinations the account is authorized to enter are included — never leaks
 *   management, tutor, tutee, crew, or translation areas to accounts without access.
 * - Read-only observers (VIEWER or departed alumni observers) receive the alternate
 *   "Program Overview" label instead of "Management".
 * - The currently active area (e.g. Help Center when on /help, Program Home when on
 *   /?home=1) is omitted from the dropdown so users only see other destinations to jump to.
 */
export function resolveWorkspaceNavigation({
  account,
  crewEnabled,
  currentArea,
  labels,
}: {
  account: WorkspaceNavAccount;
  crewEnabled: boolean;
  currentArea: WorkspaceArea | null;
  labels: WorkspaceNavLabels;
}): {
  managementLabel: string;
  items: WorkspaceSwitcherItem[];
} {
  const access = portalAccess(account);
  const managementLabel = access.managementReadOnly
    ? labels.viewer
    : labels.management;

  if (account.suspendedAt || account.mergedIntoId) {
    return { managementLabel, items: [] };
  }

  const elevatedOrViewer = ["HEAD", "ADMIN", "COORDINATOR", "VIEWER"].includes(
    account.role,
  );
  const canTutor =
    !account.tutorAccessRevoked &&
    !!(account.tutor ?? account.tutorId) &&
    (!elevatedOrViewer || account.tutor?.status !== "ARCHIVED");
  const canTutee =
    account.role !== "VIEWER" && (access.canParticipate || access.departed);
  const canCrew =
    crewEnabled &&
    (account.crewStatus === "ACTIVE" || account.role === "CREW");
  const canTranslate = translationAccess(account).enter;

  const all: WorkspaceSwitcherItem[] = [
    ...(access.canReadManagement
      ? [
          {
            id: "management" as const,
            href: "/admin",
            label: managementLabel,
            group: "workspaces" as const,
          },
        ]
      : []),
    ...(canTutor
      ? [
          {
            id: "tutor" as const,
            href: "/dashboard",
            label: labels.tutor,
            group: "workspaces" as const,
          },
        ]
      : []),
    ...(canTutee
      ? [
          {
            id: "tutee" as const,
            href: "/student",
            label: labels.tutee,
            group: "workspaces" as const,
          },
        ]
      : []),
    ...(canCrew
      ? [
          {
            id: "crew" as const,
            href: "/patrol",
            label: labels.crew,
            group: "workspaces" as const,
          },
        ]
      : []),
    ...(canTranslate
      ? [
          {
            id: "translations" as const,
            href: "/localization",
            label: labels.translations,
            group: "workspaces" as const,
          },
        ]
      : []),
    {
      id: "home",
      href: "/?home=1",
      label: labels.programHome,
      group: "general",
    },
    {
      id: "help",
      href: "/help",
      label: labels.helpCenter,
      group: "general",
    },
  ];

  return {
    managementLabel,
    items: currentArea ? all.filter((item) => item.id !== currentArea) : all,
  };
}

/** Helper to read the standard localized label bundle from next-intl's root translator. */
export function workspaceNavLabels(
  t: (key: string) => string,
): WorkspaceNavLabels {
  return {
    management: t("components.workspaceTitles.management"),
    viewer: t("components.workspaceTitles.viewer"),
    tutor: t("components.workspaceTitles.tutor"),
    tutee: t("components.workspaceTitles.tutee"),
    crew: t("components.workspaceTitles.patrol"),
    translations: t("components.workspaceTitles.translations"),
    programHome: t("components.workspaceTitles.programHome"),
    helpCenter: t("helpNav.title"),
  };
}

/** Localized accessible/group labels for the WorkspaceSwitcher dropdown. */
export function workspaceSwitcherLabels(t: (key: string) => string) {
  return {
    menuLabel: t("components.workspaceSwitcher.label"),
    workspacesGroupLabel: t("components.workspaceSwitcher.workspaces"),
    generalGroupLabel: t("components.workspaceSwitcher.general"),
  };
}
