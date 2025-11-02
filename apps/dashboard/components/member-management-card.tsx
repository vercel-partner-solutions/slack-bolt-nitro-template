"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-client";
import {
  getCurrentUserRole,
  listOrganizationMembers,
  updateMemberRole,
  removeMember,
} from "@/app/actions/user-config";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import CircleCheck from "./icons/circle-check";

export function MemberManagementCard() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [memberToRemove, setMemberToRemove] = useState<{
    id: string;
    name: string;
  } | null>(null);

  // Get current user's role
  const { data: roleData } = useQuery({
    queryKey: ["currentUserRole"],
    queryFn: getCurrentUserRole,
  });

  const currentUserRole = roleData?.success ? roleData.data?.role : null;
  const isAdmin = currentUserRole === "admin";

  // List organization members (only for admins)
  const {
    data: membersResult,
    isLoading: isLoadingMembers,
  } = useQuery({
    queryKey: ["organizationMembers"],
    queryFn: listOrganizationMembers,
    enabled: isAdmin,
  });

  const members = (membersResult?.success ? (membersResult.data ?? []) : []).filter((m): m is NonNullable<typeof m> => m !== null);

  // Update role mutation
  const updateRoleMutation = useMutation({
    mutationFn: ({ membershipId, newRole }: { membershipId: string; newRole: 'admin' | 'member' }) =>
      updateMemberRole(membershipId, newRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizationMembers"] });
    },
  });

  // Remove member mutation
  const removeMemberMutation = useMutation({
    mutationFn: removeMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["organizationMembers"] });
      setMemberToRemove(null);
    },
  });

  const handleRoleChange = async (membershipId: string, newRole: string) => {
    if (newRole === 'admin' || newRole === 'member') {
      await updateRoleMutation.mutateAsync({ membershipId, newRole });
    }
  };

  const handleRemoveMember = (id: string, name: string) => {
    setMemberToRemove({ id, name });
  };

  const handleConfirmRemove = async () => {
    if (memberToRemove) {
      await removeMemberMutation.mutateAsync(memberToRemove.id);
    }
  };

  if (!isAdmin) {
    return null; // Don't show card for non-admins
  }

  return (
    <>
      <div className="rounded-lg border border-border bg-background p-6">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="h-[1.25em] w-[1.25em]">
            <svg viewBox="0 0 24 24" fill="none" className="h-full w-full">
              <path
                d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z"
                fill="currentColor"
              />
            </svg>
          </span>
          Member Management
        </h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Manage workspace members and their roles.
        </p>

        {isLoadingMembers ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No members found.</p>
        ) : (
          <div className="space-y-3">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-4"
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                    {member.profilePictureUrl ? (
                      <img
                        src={member.profilePictureUrl}
                        alt={member.firstName}
                        className="h-full w-full rounded-full object-cover"
                      />
                    ) : (
                      <>
                        {member.firstName?.[0]?.toUpperCase() || member.email?.[0]?.toUpperCase() || "U"}
                      </>
                    )}
                  </div>

                  {/* Member info */}
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {member.firstName} {member.lastName}
                      </span>
                      {member.isOwner && (
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                          Owner
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{member.email}</span>
                  </div>
                </div>

                {/* Role & Actions */}
                <div className="flex items-center gap-3">
                  {member.isOwner || member.userId === user?.id ? (
                    // Owner or current user role cannot be changed
                    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
                      <CircleCheck className="h-3.5 w-3.5 text-green-600" />
                      <span className="text-xs font-medium capitalize">{member.role}</span>
                      {member.userId === user?.id && (
                        <span className="text-xs text-muted-foreground">(You)</span>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Role selector */}
                      <Select
                        value={member.role}
                        onValueChange={(value) => handleRoleChange(member.id, value)}
                        disabled={updateRoleMutation.isPending}
                      >
                        <SelectTrigger className="w-[110px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin" className="text-xs">
                            Admin
                          </SelectItem>
                          <SelectItem value="member" className="text-xs">
                            Member
                          </SelectItem>
                        </SelectContent>
                      </Select>

                      {/* Remove button */}
                      <button
                        onClick={() =>
                          handleRemoveMember(member.id, `${member.firstName} ${member.lastName}`)
                        }
                        disabled={removeMemberMutation.isPending}
                        className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Remove member confirmation dialog */}
      <AlertDialog open={!!memberToRemove} onOpenChange={() => setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{memberToRemove?.name}</strong> from this
              workspace? They will lose access to all workspace resources.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {removeMemberMutation.isPending ? "Removing..." : "Remove Member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

