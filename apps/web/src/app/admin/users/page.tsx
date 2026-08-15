"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-client";

interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  username: string;
  systemRole: string;
  status: "ACTIVE" | "SUSPENDED" | "DELETED";
  createdAt: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function refresh() {
    const params = new URLSearchParams({ take: "50", skip: "0" });
    if (search) params.set("search", search);
    const data = await apiFetch<{ users: AdminUser[]; total: number }>(`/admin/users?${params}`);
    setUsers(data.users);
    setTotal(data.total);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleStatus(u: AdminUser) {
    setBusyId(u.id);
    try {
      const action = u.status === "SUSPENDED" ? "activate" : "suspend";
      await apiFetch(`/admin/users/${u.id}/${action}`, { method: "POST" });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-white">Users ({total})</h1>

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          refresh();
        }}
      >
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or username"
          className="input max-w-sm"
        />
        <button type="submit" className="rounded-lg bg-surface-border px-4 py-2.5 text-sm text-white">
          Search
        </button>
      </form>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-border text-left text-xs uppercase text-ink-muted">
            <th className="py-2">Name</th>
            <th className="py-2">Email</th>
            <th className="py-2">Role</th>
            <th className="py-2">Status</th>
            <th className="py-2">Joined</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id} className="border-b border-surface-border/50">
              <td className="py-2 text-white">{u.displayName}</td>
              <td className="py-2 text-ink-muted">{u.email}</td>
              <td className="py-2 text-ink-muted">{u.systemRole}</td>
              <td
                className={`py-2 font-medium ${u.status === "ACTIVE" ? "text-success" : "text-danger"}`}
              >
                {u.status}
              </td>
              <td className="py-2 text-ink-muted">{new Date(u.createdAt).toLocaleDateString()}</td>
              <td className="py-2 text-right">
                <button
                  onClick={() => toggleStatus(u)}
                  disabled={busyId === u.id}
                  className="text-xs text-brand-300 disabled:opacity-50"
                >
                  {u.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-center text-ink-muted">
                No users found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
