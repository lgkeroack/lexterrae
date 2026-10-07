import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import type { AuthorizedUser, BackendRole } from '@lexterrae/shared';
import { api, getErrorMessage } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { useUndoStore } from '../stores/undoStore';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { useDocumentTitle } from '../components/common/useDocumentTitle';

const ROLE_LABELS: Record<BackendRole, string> = { admin: 'Admin', member: 'Member' };

const selectClass =
  'border border-gray-500 bg-white px-2 py-2 text-sm focus:border-black focus:outline-none focus:ring-2 focus:ring-accent disabled:text-gray-400';

/** Backend user management: admins add, remove and change the role of authorized users. */
export function UsersPage() {
  useDocumentTitle('Users');
  const myId = useAuthStore((s) => s.user?.id);
  const [users, setUsers] = useState<AuthorizedUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<BackendRole>('member');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setUsers(await api.getAuthorizedUsers());
      setLoadError(null);
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Could not load users.'));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsAdding(true);
    setAddError(null);
    try {
      const added = await api.grantBackendAccess({ email: email.trim(), role });
      setEmail('');
      setRole('member');
      await refresh();
      useUndoStore.getState().push({
        message: `Added ${added.email}.`,
        undo: async () => {
          await api.revokeBackendAccess(added.userId);
          await refresh();
        },
      });
    } catch (err) {
      setAddError(getErrorMessage(err, 'Could not add that user.'));
    } finally {
      setIsAdding(false);
    }
  };

  const changeRole = async (user: AuthorizedUser, next: BackendRole) => {
    setBusyId(user.userId);
    setActionError(null);
    try {
      await api.grantBackendAccess({ email: user.email, role: next });
      await refresh();
      useUndoStore.getState().push({
        message: `${user.email} is now ${ROLE_LABELS[next].toLowerCase()}.`,
        undo: async () => {
          await api.grantBackendAccess({ email: user.email, role: user.role });
          await refresh();
        },
      });
    } catch (err) {
      setActionError(getErrorMessage(err, 'Could not change the role.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (user: AuthorizedUser) => {
    setBusyId(user.userId);
    setActionError(null);
    try {
      await api.revokeBackendAccess(user.userId);
      await refresh();
      useUndoStore.getState().push({
        message: `Removed ${user.email}.`,
        undo: async () => {
          await api.grantBackendAccess({ email: user.email, role: user.role });
          await refresh();
        },
      });
    } catch (err) {
      setActionError(getErrorMessage(err, 'Could not remove that user.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <p className="mt-1 text-sm text-gray-500">
          People who can use the backend. Admins can also add and remove users here.
        </p>
      </div>

      <form
        onSubmit={add}
        className="mb-8 flex flex-col gap-3 border border-black p-4 sm:flex-row sm:items-end"
        noValidate
      >
        <div className="flex-1">
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="off"
            error={addError ?? undefined}
            helperText="They need an account first: ask them to sign up, then add them here."
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="new-user-role" className="text-sm font-medium">
            Role
          </label>
          <select
            id="new-user-role"
            value={role}
            onChange={(e) => setRole(e.target.value as BackendRole)}
            className={selectClass}
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button type="submit" isLoading={isAdding} disabled={!email.trim()} className="sm:mb-6">
          <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Add user
        </Button>
      </form>

      {actionError && (
        <p role="alert" className="mb-4 text-sm font-bold italic">
          {actionError}
        </p>
      )}

      {loadError ? (
        <div role="alert" className="text-sm">
          <p className="font-bold italic">{loadError}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void refresh()}>
            Try again
          </Button>
        </div>
      ) : !users ? (
        <LoadingSpinner label="Loading users" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-black">
                <th scope="col" className="py-2 pr-4 font-bold">
                  Name
                </th>
                <th scope="col" className="py-2 pr-4 font-bold">
                  Email
                </th>
                <th scope="col" className="py-2 pr-4 font-bold">
                  Role
                </th>
                <th scope="col" className="py-2 pr-4 font-bold">
                  Added
                </th>
                <th scope="col" className="py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.userId === myId;
                const isBusy = busyId === u.userId;
                return (
                  <tr key={u.userId} className="border-b border-gray-300 align-middle">
                    <td className="py-2 pr-4">
                      {u.displayName}
                      {isMe && <span className="ml-1 text-gray-500">(you)</span>}
                    </td>
                    <td className="py-2 pr-4">{u.email}</td>
                    <td className="py-2 pr-4">
                      {isMe ? (
                        ROLE_LABELS[u.role]
                      ) : (
                        <select
                          aria-label={`Role for ${u.email}`}
                          value={u.role}
                          disabled={isBusy}
                          onChange={(e) => void changeRole(u, e.target.value as BackendRole)}
                          className={selectClass}
                        >
                          <option value="member">Member</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">
                      {new Date(u.grantedAt).toLocaleDateString()}
                      {u.grantedBy && <span className="block text-xs">by {u.grantedBy}</span>}
                    </td>
                    <td className="py-2 text-right">
                      {!isMe && (
                        <Button
                          variant="ghost"
                          size="sm"
                          isLoading={isBusy}
                          onClick={() => void remove(u)}
                          aria-label={`Remove ${u.email}`}
                        >
                          <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
