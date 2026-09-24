const nonempty = (value: string | null | undefined) =>
  value?.trim() ? value.trim() : undefined;
/** Human identities, including historical requesters; IDs remain values, never UI labels. */
export function requesterLabels(
  requests: { requesterId: string; requesterName: string }[],
  users: {
    id: string;
    name: string | null;
    username: string | null;
    email: string | null;
  }[],
) {
  const byId = new Map(users.map((user) => [user.id, user]));
  const rows = requests.map((request) => {
    const user = byId.get(request.requesterId);
    const name =
      nonempty(user?.name) ??
      nonempty(user?.username) ??
      nonempty(user?.email) ??
      (request.requesterName !== request.requesterId
        ? request.requesterName
        : "Former team member");
    return {
      id: request.requesterId,
      name,
      email: user?.email,
      username: user?.username,
    };
  });
  return rows
    .map((row) => ({
      id: row.id,
      label:
        rows.filter((other) => other.name === row.name).length > 1
          ? `${row.name} (${row.email ?? row.username ?? "former account"})`
          : row.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
