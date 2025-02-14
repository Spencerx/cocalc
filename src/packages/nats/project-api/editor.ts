import type { NbconvertParams } from "@cocalc/util/jupyter/types";
import type { RunNotebookOptions } from "@cocalc/util/jupyter/nbgrader-types";
import type { Options as FormatterOptions } from "@cocalc/util/code-formatter";

export const editor = {
  jupyterStripNotebook: true,
  jupyterNbconvert: true,
  jupyterRunNotebook: true,
  formatterString: true,
};

export interface Editor {
  jupyterStripNotebook: (path_ipynb: string) => Promise<string>;
  jupyterNbconvert: (opts: NbconvertParams) => Promise<void>;
  jupyterRunNotebook: (opts: RunNotebookOptions) => Promise<string>;

  // returns a patch to transform str into formatted form.
  formatterString: (opts: {
    str: string;
    options: FormatterOptions;
    path?: string; // only used for CLANG
  }) => Promise<string>;
}
