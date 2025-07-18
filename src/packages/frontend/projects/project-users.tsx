/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Showing list of users of a project
*/
import {
  Component,
  redux,
  rclass,
  rtypes,
} from "@cocalc/frontend/app-framework";
import { UserMap } from "@cocalc/frontend/todo-types";
import { User } from "@cocalc/frontend/users";
import { r_join } from "@cocalc/frontend/components/r_join";
import { Loading } from "@cocalc/frontend/components/loading";

interface ReactProps {
  project: any;
  none?: React.JSX.Element;
}

interface ReduxProps {
  user_map: UserMap;
  account_id: string;
}

export const ProjectUsers = rclass<ReactProps>(
  class ProjectUsers extends Component<ReactProps & ReduxProps> {
    static reduxProps = () => {
      return {
        users: {
          user_map: rtypes.immutable,
        },
        account: {
          account_id: rtypes.string,
        },
      };
    };

    render() {
      if (this.props.user_map == undefined) {
        return <Loading />;
      }
      const users = this.props.project.get("users");
      let user_array: any[];
      if (users != undefined) {
        user_array = users.keySeq().toArray();
      } else {
        user_array = [];
      }

      let other: { account_id: string; last_active?: Date }[] = [];
      for (const account_id of user_array) {
        if (account_id !== this.props.account_id) {
          other.push({ account_id });
        }
      }

      // injects last_active
      other = redux
        .getStore("projects")
        .sort_by_activity(other, this.props.project.get("project_id"));

      const v: any = [];
      for (const user of other) {
        v.push(
          <User
            key={user.account_id}
            last_active={user.last_active}
            account_id={user.account_id}
            user_map={this.props.user_map}
          />,
        );
      }
      if (v.length > 0) {
        return r_join(v);
      } else if (this.props.none) {
        return this.props.none;
      } else {
        return <span />;
      }
    }
  },
);
