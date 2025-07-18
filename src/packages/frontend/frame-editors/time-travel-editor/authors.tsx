/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Popover, Tooltip } from "antd";
const { User } = require("../../users");
import { Loading, r_join } from "../../components";
import { TimeTravelActions } from "./actions";
import {
  isEncodedNumUUID,
  decodeUUIDtoNum,
} from "@cocalc/util/compute/manager";
import ComputeServer from "@cocalc/frontend/compute/inline";
import { useTypedRedux } from "@cocalc/frontend/app-framework";
import { plural } from "@cocalc/util/misc";

interface Props {
  actions: TimeTravelActions;
  version0: number | undefined;
  version1: number | undefined;
}

export function GitAuthors({ actions, version0, version1 }: Props) {
  if (version0 == null || version1 == null) {
    return null;
  }
  const names = actions.gitNames(version0, version1);
  const data: { [person: string]: { emails: Set<string>; count: number } } = {};
  const people: string[] = [];
  for (const name of names) {
    const i = name.lastIndexOf("<");
    const email = name.slice(i + 1, -1).trim();
    const person = name.slice(0, i).trim();
    people.push(person);
    if (data[person] == null) {
      data[person] = { emails: new Set([email]), count: 1 };
    } else {
      data[person].emails.add(email);
      data[person].count += 1;
    }
  }
  const w = Array.from(new Set(people));
  w.sort();
  const v: React.JSX.Element[] = [];
  for (const person of w) {
    v.push(
      <Popover
        key={person}
        title={
          <>
            {data[person].count} {plural(data[person].count, "Commit")}
          </>
        }
        content={Array.from(data[person].emails).join(", ")}
      >
        {person} {data[person].count > 1 ? `(${data[person].count})` : ""}
      </Popover>,
    );
  }
  return <span>{r_join(v)}</span>;
}

export function TimeTravelAuthors({ actions, version0, version1 }: Props) {
  const userMap = useTypedRedux("users", "user_map");
  if (version0 == null || version1 == null) {
    return null;
  }

  const renderUser = (account_id: string) => {
    return <User account_id={account_id} user_map={userMap} key={account_id} />;
  };

  const renderProject = () => {
    return (
      <Tooltip
        title={"This change or output was generated by the Project."}
        key="project-author"
      >
        <span>The Project</span>
      </Tooltip>
    );
  };

  const renderUnknown = () => {
    return (
      <Tooltip
        title={"You are no longer a collaborator with this user"}
        key={"unknown-author"}
      >
        <span>Unknown</span>
      </Tooltip>
    );
  };

  const renderComputeServer = (id: number) => {
    return (
      <Tooltip
        key={`compute-server${id}`}
        title={
          <>
            This change or output was generated by <ComputeServer id={id} />.
          </>
        }
      >
        <span>
          <ComputeServer id={id} titleOnly />
        </span>
      </Tooltip>
    );
  };

  const renderAuthor = (account_id: string) => {
    if (userMap != null && userMap.has(account_id)) {
      return renderUser(account_id);
    } else if (account_id == actions.project_id) {
      return renderProject();
    } else if (isEncodedNumUUID(account_id)) {
      return renderComputeServer(decodeUUIDtoNum(account_id));
    } else {
      return renderUnknown();
    }
  };

  const renderContent = () => {
    if (userMap == null) {
      return <Loading />;
    }
    const v: React.JSX.Element[] = [];
    for (const account_id of actions.get_account_ids(version0, version1)) {
      v.push(renderAuthor(account_id));
    }
    if (v.length == 0) return renderUnknown();
    return r_join(v);
  };

  return <span>{renderContent()}</span>;
}
