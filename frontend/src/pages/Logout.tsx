import { auth } from "app";
import { useEffect } from "react";
import { stopTeamPushBeforeLogout } from "../utils/team-push";

export default function Logout() {
  useEffect(() => {
    stopTeamPushBeforeLogout().finally(() => auth.signOut());
  }, []);

  return null;
}