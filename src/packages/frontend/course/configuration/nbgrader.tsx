/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Checkbox } from "@cocalc/frontend/antd-bootstrap";
import {
  CSS,
  redux,
  useActions,
  useRedux,
} from "@cocalc/frontend/app-framework";
import { A, Icon } from "@cocalc/frontend/components";
import { InputNumber } from "antd";
import { SelectProject } from "@cocalc/frontend/projects/select-project";
import { Card, Radio } from "antd";
import { CourseActions } from "../actions";
import {
  NBGRADER_CELL_TIMEOUT_MS,
  NBGRADER_MAX_OUTPUT,
  NBGRADER_MAX_OUTPUT_PER_CELL,
  NBGRADER_TIMEOUT_MS,
} from "../assignments/consts";

const radioStyle: CSS = {
  display: "block",
  whiteSpace: "normal",
  fontWeight: "inherit",
};

interface Props {
  name: string;
}

export function Nbgrader({ name }: Props) {
  const settings = useRedux([name, "settings"]);
  const course_project_id = useRedux([name, "course_project_id"]);
  const actions: CourseActions = useActions({ name });
  if (actions == null) {
    throw Error("bug");
  }

  function render_grade_project(): React.JSX.Element {
    const location = settings?.get("nbgrader_grade_project")
      ? "project"
      : "student";
    return (
      <div
        style={{
          border: "1px solid lightgrey",
          padding: "10px",
          borderRadius: "5px",
        }}
      >
        <h6>
          Where to autograde assignments:{" "}
          {location == "student"
            ? "in each student's project"
            : "specific project"}
        </h6>
        <Radio.Group
          onChange={(e) => {
            if (e.target.value == "student") {
              actions.configuration.set_nbgrader_grade_project("");
            } else {
              actions.configuration.set_nbgrader_grade_project(
                course_project_id,
              );
            }
          }}
          value={location}
        >
          <Radio value={"student"} key={"student"} style={radioStyle}>
            Grade assignments in each student's own project
          </Radio>
          <Radio value={"project"} key={"project"} style={radioStyle}>
            Grade assignments in a project of your choice
          </Radio>
        </Radio.Group>
        <br />
        {location == "project" && (
          <div>
            <SelectProject
              style={{ width: "100%", padding: "5px 25px" }}
              onChange={actions.configuration.set_nbgrader_grade_project}
              value={settings?.get("nbgrader_grade_project")}
            />
            {settings?.get("nbgrader_grade_project") &&
              settings?.get("nbgrader_grade_project") != course_project_id && (
                <a
                  style={{ marginLeft: "25px" }}
                  onClick={() =>
                    redux.getActions("projects").open_project({
                      project_id: settings?.get("nbgrader_grade_project"),
                      switch_to: true,
                    })
                  }
                >
                  Open grading project...
                </a>
              )}
          </div>
        )}
        <hr />
        <i>Where to grade:</i> choose the project in which to run autograding.
        You can create a new project dedicated to running nbgrader, upgrade or
        license it appropriately, and copy any files to it that student work
        depends on. This new project will be shared will all collaborators of
        this instructorproject.
        <br />
        You can also grade all student work in the student's own project, which
        is good because the code runs in the same environment as the student
        work (and won't harm any files you have), but can be slower since each
        student project has to start running.
      </div>
    );
  }

  function render_include_hidden_tests(): React.JSX.Element {
    return (
      <div
        style={{
          border: "1px solid lightgrey",
          padding: "10px",
          borderRadius: "5px",
        }}
      >
        <h6>
          Nbgrader hidden tests:{" "}
          {settings?.get("nbgrader_include_hidden_tests")
            ? "Included"
            : "NOT included"}
        </h6>
        <Checkbox
          checked={settings?.get("nbgrader_include_hidden_tests")}
          onChange={(e) =>
            actions.configuration.set_nbgrader_include_hidden_tests(
              (e.target as any).checked,
            )
          }
        >
          <i>Include the hidden tests:</i> Select this if you want the notebook
          to contain why answers failed your hidden tests. The drawback is that
          if you return assignments to your students, then you will reveal all
          the hidden tests to the students.
        </Checkbox>
      </div>
    );
  }

  function render_timeouts(): React.JSX.Element {
    const timeout = Math.round(
      settings.get("nbgrader_timeout_ms", NBGRADER_TIMEOUT_MS) / 1000,
    );
    const cell_timeout = Math.round(
      settings.get("nbgrader_cell_timeout_ms", NBGRADER_CELL_TIMEOUT_MS) / 1000,
    );
    return (
      <div
        style={{
          border: "1px solid lightgrey",
          padding: "10px",
          borderRadius: "5px",
        }}
      >
        <h6>Nbgrader timeouts: {timeout} seconds</h6>
        <i>Grading timeout in seconds:</i> if grading a student notebook takes
        longer than <i>{timeout} seconds</i>, then it is terminated with a
        timeout error.
        <InputNumber
          onChange={(n) =>
            actions.configuration.set_nbgrader_timeout_ms(
              n ? n * 1000 : undefined,
            )
          }
          min={30}
          max={3600}
          value={timeout}
        />
        <br />
        <i>Cell grading timeout in seconds:</i> if grading a cell in a student
        notebook takes longer than <i>{cell_timeout} seconds</i>, then that cell
        is terminated with a timeout error.
        <InputNumber
          onChange={(n) =>
            actions.configuration.set_nbgrader_cell_timeout_ms(
              n ? Math.min(n * 1000, timeout * 1000) : undefined,
            )
          }
          min={5}
          max={3600}
          value={cell_timeout}
        />
      </div>
    );
  }

  function render_limits(): React.JSX.Element {
    const max_output = Math.round(
      settings.get("nbgrader_max_output", NBGRADER_MAX_OUTPUT),
    );
    const max_output_per_cell = Math.round(
      settings.get(
        "nbgrader_max_output_per_cell",
        NBGRADER_MAX_OUTPUT_PER_CELL,
      ),
    );
    return (
      <div
        style={{
          border: "1px solid lightgrey",
          padding: "10px",
          borderRadius: "5px",
        }}
      >
        <h6>Nbgrader output limits: {Math.round(max_output / 1000)} KB</h6>
        <i>Max output:</i> if total output from all cells exceeds{" "}
        {Math.round(max_output / 1000)} KB, then further output is truncated.
        <InputNumber
          onChange={(n) =>
            actions.configuration.set_nbgrader_max_output(
              n ? n * 1000 : undefined,
            )
          }
          min={1}
          max={10000}
          value={Math.round(max_output / 1000)}
        />
        <br />
        <i>Max output per cell:</i> if output from a cell exceeds{" "}
        {Math.round(max_output_per_cell / 1000)} KB, then further output is
        truncated.
        <InputNumber
          onChange={(n) =>
            actions.configuration.set_nbgrader_max_output_per_cell(
              n ? n * 1000 : undefined,
            )
          }
          min={1}
          max={10000}
          value={Math.round(max_output_per_cell / 1000)}
        />
      </div>
    );
  }

  function render_parallel(): React.JSX.Element {
    const parallel = Math.round(
      settings.get("nbgrader_parallel") ??
        actions.get_store().get_nbgrader_parallel(),
    );
    return (
      <div
        style={{
          border: "1px solid lightgrey",
          padding: "10px",
          borderRadius: "5px",
        }}
      >
        <h6>
          Nbgrader parallel limit:{" "}
          {parallel > 1
            ? `grade ${parallel} students at once`
            : "one student a time"}
        </h6>
        <i>Max number of students</i> to grade in parallel. What is optimal
        could depend on where grading is happening (see "Where to autograde
        assignments" above), and compute resources you or your students have
        bought.
        <InputNumber
          onChange={(n) =>
            actions.configuration.set_nbgrader_parallel(n ? n : undefined)
          }
          min={1}
          max={50}
          value={parallel}
        />
      </div>
    );
  }

  return (
    <Card
      title={
        <A href="https://doc.cocalc.com/teaching-nbgrader.html">
          <Icon name="graduation-cap" /> Nbgrader
        </A>
      }
    >
      {render_grade_project()}
      <br />
      {render_include_hidden_tests()}
      <br />
      {render_timeouts()}
      <br />
      {render_limits()}
      <br />
      {render_parallel()}
    </Card>
  );
}
