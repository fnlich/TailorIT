'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { initialsOf } from '@tailorit/shared/auth';
import { Badge } from '@/components/ui/Badge';
import { LetterAvatar } from '@/components/ui/LetterAvatar';
import { Notice } from '@/components/ui/Notice';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { userMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, relativeTime } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { adminKeys, fetchUsers, updateUser } from './api';
import { AdminTable, SectionHeader, TableSkeleton, type AdminColumn } from './parts';
import type { AdminUser, ListAnswer } from './types';

/** Admin > Users: every account, its role, and whether it may sign in. */
export function UsersTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const { account } = useAuth();
  const users = useQuery({ queryKey: adminKeys.users, queryFn: ({ signal }) => fetchUsers(signal) });

  const change = useMutation({
    mutationFn: ({ user, patch }: { user: AdminUser; patch: { role?: AdminUser['role']; disabled?: boolean } }) => updateUser(user.id, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(adminKeys.users, (previous: ListAnswer<AdminUser> | undefined) =>
        previous ? { ...previous, items: previous.items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)) } : previous,
      );
      if (updated.note) toast.info('Saved, with a note', updated.note);
      else toast.success('Account updated');
    },
    onError: (error) => toast.error('The account was not changed', userMessage(error)),
  });

  const columns: AdminColumn<AdminUser>[] = [
    {
      key: 'account',
      header: 'Account',
      cell: (user) => (
        <div className="flex min-w-0 items-center gap-3">
          <LetterAvatar letters={initialsOf(user.name, user.email)} size={32} tone="brand" />
          <div className="min-w-0">
            <p className="truncate font-semibold">
              {user.name || user.email}
              {user.id === account?.id && <span className="ml-2 font-normal text-muted-foreground">(you)</span>}
            </p>
            <p className="truncate text-[13px] text-muted-foreground">{user.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      className: 'w-40',
      cell: (user) => (
        <Select
          aria-label={`Role of ${user.email}`}
          options={[
            { value: 'user', label: 'User' },
            { value: 'admin', label: 'Admin' },
          ]}
          value={user.role}
          size="sm"
          className="w-32"
          disabled={change.isPending}
          onValueChange={(role) => role !== user.role && change.mutate({ user, patch: { role } })}
        />
      ),
    },
    {
      key: 'active',
      header: 'Can sign in',
      className: 'w-36',
      cell: (user) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={!user.disabled}
            disabled={change.isPending}
            onCheckedChange={(enabled) => change.mutate({ user, patch: { disabled: !enabled } })}
            aria-label={`${user.disabled ? 'Enable' : 'Disable'} ${user.email}`}
          />
          {user.disabled && <Badge tone="destructive">Disabled</Badge>}
        </div>
      ),
    },
    { key: 'joined', header: 'Joined', className: 'w-36 text-muted-foreground', cell: (user) => formatDate(user.createdAt) },
    {
      key: 'seen',
      header: 'Last sign-in',
      className: 'w-40 text-muted-foreground',
      cell: (user) => (user.lastSignInAt ? relativeTime(user.lastSignInAt, now) : 'Never'),
    },
  ];

  return (
    <section>
      <SectionHeader title="Users" description="Accounts on this installation. Addresses in ADMIN_EMAILS become administrators when they sign in." />
      {users.isError ? (
        <Notice tone="error" title="The accounts could not be loaded">
          {userMessage(users.error)}
        </Notice>
      ) : users.isPending ? (
        <TableSkeleton />
      ) : (
        <AdminTable aria-label="Accounts" items={users.data.items} columns={columns} getKey={(user) => user.id} />
      )}
    </section>
  );
}
