/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/* Definition and control logic behind the various button bars.
//
There is a level of separation between the button bar's and the actual content what they insert/modify.
This is motivated by editing text, where various markups have different realizations ("B"old button -> **abc** or <b>abc</b>)

There are less/none overlaps for programming languages.

FUTURE:
    * think about creating a dedicated dialog for more elaborate examples,
      which should also have a client/server communication to avoid bloat
      (think of a repository of hundrets of full examples with explanatory text)
    * work out how codemirror should react if there is a text selected or multiple
      cursors active (just the primary one!?)

CONSIDERATIONS:
    * buttons should insert code which immediately works:
      it's easier for users to delete lines than to end up with some partial broken fragments
*/

import $ from "jquery";

export const FONT_SIZES = [
  "xx-small",
  "x-small",
  "small",
  "medium",
  "large",
  "x-large",
  "xx-large",
] as const;

export const FONT_FACES = [
  "Serif",
  "Sans",
  "Arial",
  "Arial Black",
  "Courier",
  "Courier New",
  "Comic Sans MS",
  "Cursive",
  "Georgia",
  "Helvetica",
  "Impact",
  "Lucida Grande",
  "Lucida Sans",
  "Monaco",
  "Palatino",
  "Tahoma",
  "Times New Roman",
  "Ubuntu",
  "Verdana",
] as const;

let i, j, k;

export const commands = {
  shell: {
    comment: {
      wrap: {
        left: "#",
        right: "",
        multi: true,
        space: true,
      },
    },
    set_name_and_email: {
      insert: `\
git config --global user.name ""
git config --global user.email ""\
`,
    },
    initalize_git: {
      insert: `\
git init\
`,
    },
    create_gitignore: {
      insert: `\
# See examples of .gitignore files at https://github.com/github/gitignore
echo "
# For CoCalc files like .sage-chat etc
*.sage-chat
*.sage-history
*.term
*.py[cod]" >> .gitignore\
`,
    },
    clone_local_repo: {
      insert: `\
git clone ~/local_dir/\
`,
    },
    clone_remote_repo: {
      insert: `\
git clone https://github.com/sagemathinc/cocalc.git\
`,
    },
    add_file_to_repo: {
      insert: `\
git add afile.py\
`,
    },
    add_all_to_repo: {
      insert: `\
git add *\
`,
    },
    diff: {
      insert: `\
git diff\
`,
    },
    commit: {
      insert: `\
git commit -a -m "commit message"\
`,
    },
    setup_ssh_for_github: {
      insert: `\
set -e
mkdir -p ~/.ssh/
SSHFILE=~/.ssh/id_rsa
ssh-keygen -t rsa -b 4096 -N "" -C "your_email@example.com" -f $SSHFILE
eval $(ssh-agent -s)
ssh-add ~/.ssh/id_rsa
echo "Below this line is your public SSH key"
cat ~/.ssh/id_rsa.pub
# Copy your public key below and follow the instructions at https://help.github.com/articles/adding-a-new-ssh-key-to-your-github-account/#platform-linux\
`,
    },
    push_origin_master: {
      insert: `\
git push origin master\
`,
    },

    status: {
      insert: `\
git status\
`,
    },

    add_remote_repo: {
      insert: `\
git remote add origin <server>\
`,
    },

    list_remote_repos: {
      insert: `\
git remote -v\
`,
    },

    create_new_branch: {
      insert: `\
git checkout -b <branchname>\
`,
    },

    switch_branches: {
      insert: `\
git checkout <branchname>\
`,
    },

    list_branches: {
      insert: `\
git branch\
`,
    },

    delete_the_feature_branch: {
      insert: `\
git branch -d <branchname>\
`,
    },

    push_branch: {
      insert: `\
git push origin <branchname>\
`,
    },

    push_all_branches: {
      insert: `\
git push --all origin\
`,
    },

    delete_remote_branch: {
      insert: `\
git push origin --delete <branchName>\
`,
    },

    pull: {
      insert: `\
git pull\
`,
    },

    merge_branch: {
      insert: `\
git merge <branchname>
git diff
git diff --base <filename>
git diff <sourcebranch> <targetbranch>
git add <filename>\
`,
    },

    show_history: {
      insert: `\
git log\
`,
    },

    undo_local_changes: {
      insert: `\
git checkout -- <filename>\
`,
    },

    get_rid_of_local_changes: {
      insert: `\
git fetch origin
git reset --hard origin/master\
`,
    },

    search_for: {
      insert: `\
git grep "foo()"\
`,
    },
  },
  tex: {
    integral: {
      insert: "$int_{0}^{infty} \frac{1}{1+x^2},mathrm{d}x$",
    },
    cases: {
      insert: `\
$$
f(n) =
\begin{cases}
    2 (n+1)    & \text{if} n \equiv 0 \\
    (3n+1)/2   & \text{if} n \equiv 1.
\end{cases}
$$\
`,
    },
    bold: {
      wrap: {
        left: "\\textbf{",
        right: "}",
      },
    },
    italic: {
      wrap: {
        left: "\\textit{",
        right: "}",
      },
    },
    underline: {
      wrap: {
        left: "\\underline{",
        right: "}",
      },
    },
    strikethrough: {
      // requires the soul package
      wrap: {
        left: "\\st{",
        right: "}",
      },
    },
    equation: {
      default: "x^2",
      wrap: {
        left: "$",
        right: "$",
      },
    },
    display_equation: {
      default: "x^2",
      wrap: {
        left: "$$",
        right: "$$",
      },
    },
    insertunorderedlist: {
      wrap: {
        left: "\\begin{itemize}\n    \\item\n",
        right: "\\end{itemize}",
      },
    },
    insertorderedlist: {
      wrap: {
        left: "\\begin{enumerate}\n    \\item\n",
        right: "\\end{enumerate}",
      },
    },
    format_heading_0: {
      strip: [
        "format_heading_1",
        "format_heading_2",
        "format_heading_3",
        "format_heading_4",
      ],
      wrap: { left: "", right: "" },
    },
    format_heading_1: {
      strip: ["format_heading_2", "format_heading_3", "format_heading_4"],
      wrap: {
        left: "\\section{",
        right: "}",
      },
    },
    format_heading_2: {
      strip: ["format_heading_1", "format_heading_3", "format_heading_4"],
      wrap: {
        left: "\\subsection{",
        right: "}",
      },
    },
    format_heading_3: {
      strip: ["format_heading_1", "format_heading_2", "format_heading_4"],
      wrap: {
        left: "\\subsubsection{",
        right: "}",
      },
    },
    format_heading_4: {
      strip: ["format_heading_1", "format_heading_2", "format_heading_4"],
      wrap: {
        left: "\\subsubsubsection{",
        right: "}",
      },
    },
    format_code: {
      wrap: {
        left: "\n\\begin{verbatim}\n",
        right: "\n\\end{verbatim}\n",
      },
    },
    indent: {
      wrap: {
        left: "\n\\begin{quote}\n",
        right: "\n\\end{quote}\n",
      },
    },
    quote: {
      wrap: {
        left: "\n\\begin{quote}\n",
        right: "\n\\end{quote}\n",
      },
    },
    table: {
      wrap: {
        left: "\n\\begin{center}\\begin{tabular}{|c|c|}\n\\hline\ncell1 & cell2 \\\\\ncell3 & cell4 \\\\\n\\hline",
        right: "\n\\end{tabular}\\end{center}\n",
      },
    },
    subscript: {
      wrap: {
        left: "_{",
        right: "}",
      },
    },
    superscript: {
      wrap: {
        left: "^{",
        right: "}",
      },
    },
    comment: {
      wrap: {
        left: "%",
        right: "",
        multi: true,
        space: true,
      },
    },
    horizontalRule: {
      wrap: {
        left: "\\hrulefill",
        //left  : "\n\\noindent\\makebox[\\linewidth]{\\rule{\\paperwidth}{0.4pt}}\n"
        right: "",
      },
    },
    justifyleft: {
      wrap: {
        left: "\n\\begin{flushleft}\n",
        right: "\n\\end{flushleft}\n",
      },
    },
    justifyright: {
      wrap: {
        left: "\n\\begin{flushright}\n",
        right: "\n\\end{flushright}\n",
      },
    },
    justifycenter: {
      wrap: {
        left: "\n\\begin{center}\n",
        right: "\n\\end{center}\n",
      },
    },
  },

  md: {
    bold: {
      wrap: {
        left: "**",
        right: "**",
      },
    },
    italic: {
      wrap: {
        left: "_",
        right: "_",
      },
    },
    underline: {
      wrap: {
        left: "<u>",
        right: "</u>",
      },
    },
    strikethrough: {
      wrap: {
        left: "~~",
        right: "~~",
      },
    },
    code: {
      wrap: {
        left: "`",
        right: "`",
      },
    },
    insertunorderedlist: {
      wrap: {
        left: " - first\n - second\n",
        right: "",
        multi: true,
        space: false,
        newline: true,
        trim: false,
      },
    },
    insertorderedlist: {
      wrap: {
        left: "1. first\n2. second\n",
        right: "",
        multi: true,
        space: false,
        newline: true,
        trim: false,
      },
    },
    format_code: {
      wrap: {
        left: "    ",
        right: "",
        multi: true,
        space: false,
        newline: true,
        trim: false,
      },
    },
    format_heading_0: {
      strip: [
        "format_heading_1",
        "format_heading_2",
        "format_heading_3",
        "format_heading_4",
        "format_heading_5",
        "format_heading_6",
      ],
      wrap: { left: "", right: "" },
    },
    indent: {
      wrap: {
        left: "> ",
        right: "",
        multi: true,
        space: false,
        newline: true,
        trim: false,
      },
    },
    quote: {
      wrap: {
        left: "> ",
        right: "",
        multi: true,
        space: false,
        newline: true,
        trim: false,
      },
    },
    horizontalRule: {
      wrap: {
        left: "\n---\n",
        right: "",
      },
    },
    table: {
      wrap: {
        left: `\
| Left-Aligned  | Center Aligned  | Right Aligned |
| :------------ |:---------------:| -------------:|
| col 3 is      | some wordy text |          1600 |
| col 2 is      |    centered     |            12 |
| zebra stripes |    and math     |      $\\pi^3$ |\
`,
        right: "",
      },
    },
  },

  html: {
    italic: {
      wrap: {
        left: "<em>",
        right: "</em>",
      },
    },
    bold: {
      wrap: {
        left: "<strong>",
        right: "</strong>",
      },
    },
    underline: {
      wrap: {
        left: "<u>",
        right: "</u>",
      },
    },
    strikethrough: {
      wrap: {
        left: "<strike>",
        right: "</strike>",
      },
    },
    subscript: {
      wrap: {
        left: "<sub>",
        right: "</sub>",
      },
    },
    superscript: {
      wrap: {
        left: "<sup>",
        right: "</sup>",
      },
    },
    comment: {
      wrap: {
        left: "<!--",
        right: " -->",
        space: true,
      },
    },
    insertunorderedlist: {
      wrap: {
        left: "\n<ul>\n    <li> ",
        right: "</li>\n</ul>\n",
      },
    },
    insertorderedlist: {
      wrap: {
        left: "\n<ol>\n    <li> ",
        right: "</li>\n</ol>\n",
      },
    },
    justifyleft: {
      // FUTURE -- define via for loop below
      strip: ["justifycenter", "justifyright", "justifyfull"],
      wrap: {
        left: "",
        right: "",
      },
    },
    justifycenter: {
      strip: ["justifycenter", "justifyright", "justifyleft"],
      wrap: {
        left: "<div style='text-align:center'>",
        right: "</div>",
      },
    },
    justifyright: {
      strip: ["justifycenter", "justifyright", "justifyleft"],
      wrap: {
        left: "<div style='text-align:right'>",
        right: "</div>",
      },
    },
    justifyfull: {
      strip: ["justifycenter", "justifyright", "justifyleft"],
      wrap: {
        left: "<div style='text-align:justify'>",
        right: "</div>",
      },
    },
    indent: {
      wrap: {
        left: "<blockquote>",
        right: "</blockquote>",
      },
    },
    format_heading_0: {
      strip: [
        "format_heading_1",
        "format_heading_2",
        "format_heading_3",
        "format_heading_4",
      ],
      wrap: { left: "", right: "" },
    },
    format_heading_1: {
      // FUTURE -- define via for loop below
      strip: ["format_heading_2", "format_heading_3", "format_heading_4"],
      wrap: {
        left: "<h1>",
        right: "</h1>",
      },
    },
    format_heading_2: {
      strip: ["format_heading_1", "format_heading_3", "format_heading_4"],
      wrap: {
        left: "<h2>",
        right: "</h2>",
      },
    },
    format_heading_3: {
      strip: ["format_heading_1", "format_heading_2", "format_heading_4"],
      wrap: {
        left: "<h3>",
        right: "</h3>",
      },
    },
    format_heading_4: {
      strip: ["format_heading_1", "format_heading_2", "format_heading_3"],
      wrap: {
        left: "<h4>",
        right: "</h4>",
      },
    },
    format_code: {
      wrap: {
        left: "<pre>",
        right: "</pre>",
      },
    },
    equation: {
      default: "x^2",
      wrap: {
        left: "$",
        right: "$",
      },
    },
    display_equation: {
      default: "x^2",
      wrap: {
        left: "$$",
        right: "$$",
      },
    },
    table: {
      wrap: {
        left: `\
<table>
    <tr>
        <th>Header 1</th>
        <th>Header 2</th>
    </tr>
    <tr>
        <td>Cell 1</td>
        <td>Cell 2</td>
    </tr>
    <tr>
        <td>Cell 3</td>
        <td>Cell 4</td>
    </tr>
</table>\
`,
        right: "\n",
      },
    },
    horizontalRule: {
      wrap: {
        left: "\n<hr size='1'/>\n",
        right: "",
      },
    },
  },

  rst: {
    // there is intentionally no underline or strikethough in rst
    italic: {
      wrap: {
        left: "*",
        right: "*",
      },
    },
    bold: {
      wrap: {
        left: "**",
        right: "**",
      },
    },
    subscript: {
      wrap: {
        left: " :sub:`",
        right: "` ",
      },
    },
    superscript: {
      wrap: {
        left: " :sup:`",
        right: "` ",
      },
    },
    comment: {
      wrap: {
        left: "\n..",
        right: "",
        multi: true,
        space: true,
      },
    },
    insertunorderedlist: {
      wrap: {
        left: "\n  - ",
        right: "",
      },
    },
    insertorderedlist: {
      wrap: {
        left: "\n  1. ",
        right: "",
      },
    },
    justifyleft: {
      // FUTURE -- define via for loop below
      strip: ["justifycenter", "justifyright", "justifyfull"],
      wrap: {
        left: "",
        right: "",
      },
    },
    justifycenter: {
      strip: ["justifycenter", "justifyright", "justifyleft"],
      wrap: {
        left: "\n.. class:: center\n\n",
        right: "",
      },
    },
    justifyright: {
      strip: ["justifycenter", "justifyright", "justifyleft"],
      wrap: {
        left: "\n.. class:: right\n\n",
        right: "",
      },
    },
    justifyfull: {
      strip: ["justifycenter", "justifyright", "justifyleft"],
      wrap: {
        left: "\n.. class:: justify\n\n",
        right: "",
      },
    },
    indent: {
      wrap: {
        left: "\n  ",
        right: "",
      },
    },
    format_heading_0: {
      strip: [
        "format_heading_1",
        "format_heading_2",
        "format_heading_3",
        "format_heading_4",
      ],
      wrap: { left: "", right: "" },
    },
    format_heading_1: {
      // FUTURE -- define via for loop below
      strip: ["format_heading_2", "format_heading_3", "format_heading_4"],
      wrap: {
        left: "\n===============\n",
        right: "\n===============\n",
      },
    },
    format_heading_2: {
      strip: ["format_heading_1", "format_heading_3", "format_heading_4"],
      wrap: {
        left: "\n---------------\n",
        right: "\n---------------\n",
      },
    },
    format_heading_3: {
      strip: ["format_heading_1", "format_heading_2", "format_heading_4"],
      wrap: {
        left: "\n",
        right: "\n=============\n",
      },
    },
    format_heading_4: {
      strip: ["format_heading_1", "format_heading_2", "format_heading_3"],
      wrap: {
        left: "\n",
        right: "\n-------------\n",
      },
    },
    format_code: {
      wrap: {
        left: `\
.. code:: python

    def f(x):
        return 2*x\
`,
        right: "\n",
      },
    },
    equation: {
      default: "x^2",
      wrap: {
        left: " :math:`",
        right: "` ",
      },
    },
    display_equation: {
      default: "x^2",
      wrap: {
        left: "\n.. math::\n\n    ",
        right: "\n",
      },
    },
    table: {
      // the first is the more complex grid table, the second one is a "simple" table
      insert: `\
+------------+------------+-----------+
| Header 1   | Header 2   | Header 3  |
+============+============+===========+
| body row 1 | column 2   | column 3  |
+------------+------------+-----------+
| body row 2 | Cells may span columns.|
+------------+------------+-----------+
| body row 3 | Cells may  | - Cells   |
+------------+ span rows. | - contain |
| body row 4 |            | - blocks. |
+------------+------------+-----------+
\
`,
    },
    /*
                        insert: """
                                =====  =====  ======
                                   Inputs     Output
                                ------------  ------
                                  A      B    A or B
                                =====  =====  ======
                                False  False  False
                                True   False  True
                                False  True   True
                                True   True   True
                                =====  =====  ======
                                """
                        */
    horizontalRule: {
      insert: "\n------------------\n",
    },
  },

  mediawiki: {
    // https://www.mediawiki.org/wiki/Help:Formatting
    bold: {
      wrap: {
        left: "'''",
        right: "'''",
      },
    },
    italic: {
      wrap: {
        left: "''",
        right: "''",
      },
    },
    underline: {
      wrap: {
        left: "<u>",
        right: "</u>",
      },
    },
    strikethrough: {
      wrap: {
        left: "<strike>",
        right: "</strike>",
      },
    },
    insertunorderedlist: {
      wrap: {
        left: "\n* item1\n* item2\n* ",
        right: "\n",
      },
    },
    insertorderedlist: {
      wrap: {
        left: "\n# one\n# two\n# ",
        right: "\n",
      },
    },
    comment: {
      wrap: {
        left: "\n<!--",
        right: " -->\n",
        space: true,
      },
    },
    indent: {
      // pre tag is more for code, but makes more sense than a dysfunctional ":"
      wrap: {
        left: "\n<pre>",
        right: "</pre>\n",
      },
    },
    format_heading_0: {
      // FUTURE -- define via for loop below
      strip: [
        "format_heading_1",
        "format_heading_2",
        "format_heading_3",
        "format_heading_4",
      ],
      wrap: { left: "", right: "" },
    },
    format_heading_1: {
      // FUTURE -- define via for loop below
      strip: ["format_heading_2", "format_heading_3", "format_heading_4"],
      wrap: {
        left: "\n== ",
        right: " ==\n",
      },
    },
    format_heading_2: {
      strip: ["format_heading_1", "format_heading_3", "format_heading_4"],
      wrap: {
        left: "\n=== ",
        right: " ===\n",
      },
    },
    format_heading_3: {
      strip: ["format_heading_1", "format_heading_2", "format_heading_4"],
      wrap: {
        left: "\n==== ",
        right: " ====\n",
      },
    },
    format_heading_4: {
      strip: ["format_heading_1", "format_heading_2", "format_heading_3"],
      wrap: {
        left: "\n===== ",
        right: " =====\n",
      },
    },
    format_code: {
      wrap: {
        left: " <code>",
        right: "</code> ",
      },
    },
    horizontalRule: {
      wrap: {
        left: "\n----\n",
        right: "",
      },
    },
    table: {
      // https://www.mediawiki.org/wiki/Help:Tables
      insert: `\n
{| class="table"
|+Table Caption
! Column 1
! Column 2
|-
|Integral
|Derivative
|-
|Sin
|Cos
|-
|Tan
|Sec
|}\
`,
    },
  },

  python: {
    comment: {
      wrap: {
        left: "#",
        right: "",
        multi: true,
        space: true,
      },
    },
    len: {
      insert: "len([1, 2, 5, 6, 10])",
    },
    list: {
      insert: "[1, 2, 5, 6, 10]",
    },
    list_comprehension: {
      insert: "[n+1 for n in range(10) if n%2==0]",
    },
    read_csv_file: {
      insert: `\
import csv
import sys

f = open('example.csv', 'rt')
try:
    reader = csv.reader(f)
    for row in reader:
        print(row)
finally:
    f.close()\
`,
    },
    write_csv_file: {
      insert: `\
import csv
import sys

f = open('example.csv', 'wt')
try:
    writer = csv.writer(f)
    writer.writerow( ('Title 1', 'Title 2', 'Title 3') )
    for i in range(10):
        writer.writerow( (i+1, chr(ord('a') + i), '08/%02d/07' % (i+1)) )
finally:
    f.close()

print(open('example.csv', 'rt').read())\
`,
    },
    dict: {
      insert: "{'sage':'math', 3:7}",
    },
    set: {
      insert: "{7, 3, 2}",
    },
    tuple: {
      insert: "(2, 3, 7)",
    },
    forloop: {
      insert: `\
for i in range(5):
    print(i)\
`,
    },
    forlistloop: {
      insert: `\
l = [1, 2, 5, 8, 10]
for i in l:
    print(i)\
`,
    },
    forelseloop: {
      insert: `\
for k in [1, 2, 5, 10]:
    if k == 3:
        print("found k, returning")
        break
else:
    print("Haven't found k == 3")\
`,
    },
    whileloop: {
      insert: `\
n = 0
while n < 5:
    print(n)
    n += 1\
`,
    },
    if: {
      insert: `\
if i == 1:
    print('i equals 1')\
`,
    },
    ifelse: {
      insert: `\
if i == 1:
    print('i equals 1')
else:
    print('i is not 1')\
`,
    },
    cases: {
      insert: `\
if i == 0:
    print("i is zero")
elif i == 1:
    print("i is one")
else:
    print("i is neither zero or one")\
`,
    },
    function: {
      insert: `\
def f(a, b=0):
    \"\"\"
    This function returns the sum of a and b.
    \"\"\"
    return a + b\
`,
    },
    lambda: {
      insert: "f = lambda a, b: a + b",
    },
    simple_class: {
      insert: `\
class MyClass(object):
    \"\"\"
    This is a simple class.
    \"\"\"
    def __init__(self, a):
        self.a = a
    def __repr__(self):
        return "Instance of MyClass with a = %s"%self.a

print(MyClass(5))\
`,
    },
    class_inheritance: {
      insert: `\
class A(object):
    def __repr__(self):
        return "instance of A"
    def foo(self):
        return "foo"

class B(object):
    def __repr__(self):
        return "instance of B"
    def bar(self):
        return "bar"

class C(A, B):
    \"\"\"
    This is a class that inherits from classes A and B.
    \"\"\"
    def __repr__(self):
        return "instance of C"

# Both foo and bar are defined on instances of C.
c = C()
print(c.foo(), c.bar())\
`,
    },
  },
  cython: {
    cython_class: {
      insert: `\
cdef class MyClass:
    \"\"\"
    This is a Cython class.
    \"\"\"
    cdef int a
    def __init__(self, int a):
        self.a = a
    def __repr__(self):
        return "Instance of MyClass with a = %s"%self.a

print(MyClass(5))\
`,
    },
  },
  sage: {
    sagemathdoc: {
      url: "http://doc.sagemath.org/",
    },
    sagemathtutorial: {
      url: "http://doc.sagemath.org/html/en/tutorial/index.html",
    },
    sagemathreference: {
      url: "http://doc.sagemath.org/html/en/reference/index.html",
    },
    sagemathkeyboardshortcuts: {
      url: "https://github.com/sagemathinc/cocalc/wiki/Keyboard-Shortcuts",
    },
    sagesyntaxerrors: {
      url: "https://github.com/sagemathinc/cocalc/wiki/MathematicalSyntaxErrors",
    },
    cocalcwiki: {
      url: "https://doc.cocalc.com/sagews.html",
    },
    sagequestion: {
      url: "https://github.com/sagemathinc/cocalc/wiki/SageQuestion",
    },
    help: {
      wrap: {
        left: "help(",
        right: ")",
      },
    },
    differentiate: {
      insert: "diff(1 + x + x^2, x)",
    },
    integrate: {
      insert: "integrate(1 + x + x^2, x)",
    },
    nintegrate: {
      insert:
        "numerical_integral(1 + x + x^2, 0, 3)[0]  # [1] gives error bound",
    },
    symbolic_function: {
      insert: "f(x,y) = x * sin(y)",
    },
    matrix: {
      insert: "matrix(2, 3, [1,pi,3, e,5,6])",
    },
    vector: {
      insert: "vector([pi, 2, 3, e])",
    },
    plot2d: {
      insert: "plot(x * sin(x), (x, -2, 10))",
    },
    plot_line: {
      insert:
        "line([(0,0), (1,2), (1/2,pi), (1/2,pi/2)], color='darkgreen', thickness=3)",
    },
    plot_polygon: {
      insert: `\
a = polygon2d([(0,0), (1,2), (1/2,pi), (1/2,pi/2)], color='orange')
b = polygon2d([(0,0), (1,2), (1/2,pi), (1/2,pi/2)], color='black', fill=False, thickness=3)
show(a + b)\
`,
    },
    plot_parametric: {
      insert:
        "parametric_plot([cos(x) + 2*cos(x/4), sin(x) - 2*sin(x/4)], (x,0,8*pi), color='green', thickness=3, fill = True)",
    },
    plot_random_walk: {
      insert: "stats.TimeSeries(1000).randomize('normal').sums().plot()",
    },
    plot_text: {
      insert:
        'text(r"Text and LaTeX: $\\alpha^3 + 1$", (1,1), color="black", fontsize=15, rotation=30)',
    },
    plot_points: {
      insert:
        "show(points([(1,0), (sqrt(2)/2,sqrt(2)/2), (0,1), (1/2,1/2)], color='darkgreen', pointsize=50), aspect_ratio=1)",
    },
    plot3d: {
      insert: `\
%var x y
plot3d(x * sin(y), (x, -5, 5), (y, -5, 5))\
`,
    },
    plot_torus: {
      insert: `\
from sage.plot.plot3d.shapes import Torus
inner_radius = .3; outer_radius = 1
show(Torus(outer_radius, inner_radius, color='orange'), aspect_ratio=1, spin=3)\
`,
    },
    parametric_curve3d: {
      insert: `\
%var u
parametric_plot3d( (sin(u), cos(u), u/10), (u, 0, 20), thickness=5, color='green', plot_points=100)\
`,
    },
    parametric_surface: {
      insert: `\
%var u, v
fx = (3*(1+sin(v)) + 2*(1-cos(v)/2)*cos(u))*cos(v)
fy = (4+2*(1-cos(v)/2)*cos(u))*sin(v)
fz = -2*(1-cos(v)/2) * sin(u)
parametric_plot3d([fx, fy, fz], (u, 0, 2*pi), (v, 0, 2*pi), color="green", opacity=.7, mesh=1, spin=5)\
`,
    },
    implicit_plot3d: {
      insert: `\
%var x y z
g = golden_ratio; r = 4.77
p = 2 - (cos(x + g*y) + cos(x - g*y) + cos(y + g*z) +
         cos(y - g*z) + cos(z - g*x) + cos(z + g*x))
show(implicit_plot3d(p, (x, -r, r), (y, -r, r), (z, -r, r),
                plot_points=30, color='orange', mesh=1, opacity=.7), spin=1)\
`,
    },

    random_walk_3d: {
      insert: `\
v = [(0,0,0)]
for i in range(1000):
    v.append([a+random()-.5 for a in v[-1]])
line3d(v, color='red', thickness=3, spin=3)\
`,
    },
    polytope: {
      insert: `\
points = [(2,0,0), (0,2,0), (0,0,2), (-1,0,0), (0,-1,0), (0,0,-1)]
show(LatticePolytope(points).plot3d(), spin=5)\
`,
    },
    icosahedron: {
      insert: "show(icosahedron(color='green', opacity=.5, mesh=3), spin=1)",
    },
    tetrahedron: {
      insert: "show(tetrahedron(color='lime', opacity=.5, mesh=3), spin=1)",
    },
    cube: {
      insert: `\
show(cube(color=['red', 'blue', 'green'], frame_thickness=2,
         frame_color='brown', opacity=0.8), frame=False)\
`,
    },
    plot_text3d: {
      insert: 'text3d("Text in 3D", (1,1, 1), color="darkred", fontsize=20)',
    },
    graphs: {
      insert:
        "# Press the TAB key after 'graphs.' to see a list of predefined graphs.\ngraphs.",
    },
    petersen: {
      insert: "graphs.PetersenGraph()",
    },
    random_graph: {
      insert:
        "g = graphs.RandomGNM(15, 20)  # 15 vertices and 20 edges\nshow(g)\ng.incidence_matrix()",
    },
    chromatic_number: {
      insert: "g = graphs.PetersenGraph().chromatic_number()\nshow(g)",
    },
    auto_group_graph: {
      insert: "graphs.PetersenGraph().automorphism_group()",
    },
    graph_2dplot: {
      insert: "show(graphs.PetersenGraph())",
    },
    graph_3dplot: {
      insert: "show(graphs.PetersenGraph().plot3d())",
    },
    factor: {
      insert: "factor(2015)",
    },
    primes: {
      insert: "prime_range(100)",
    },
    prime_pi: {
      insert: "prime_pi(10^6)",
    },
    mod: {
      insert: "Mod(5, 12)",
    },
    contfrac: {
      insert: "continued_fraction(e)",
    },
    binary_quadform: {
      insert: "BinaryQF([1,2,3])",
    },
    ellcurve: {
      insert: "EllipticCurve([1,2,3,4,5])",
    },
    var: {
      insert: "%var x, theta",
    },
    det: {
      insert: "matrix(2, 2, [1,2, 3,4]).det()",
    },
    charpoly: {
      insert: "matrix(2, 2, [1,2, 3,4]).charpoly()",
    },
    eigen: {
      insert: "matrix(3,[1,2,3, 4,5,6, 7,8,9]).right_eigenvectors()",
    },
    svd: {
      insert: "matrix(CDF, 3, [1,2,3, 4,5,6, 7,8,9]).SVD()",
    },
    numpy_array: {
      insert: "import numpy\nnumpy.array([[1,2,3], [4,5,6]], dtype=float)",
    },

    ring_AA: {
      insert: "AA",
    },
    ring_CC: {
      insert: "CC",
    },
    ring_CDF: {
      insert: "CDF",
    },
    ring_CIF: {
      insert: "CIF",
    },
    ring_CLF: {
      insert: "CLF",
    },
    ring_FF_p: {
      insert: "GF(7)",
    },
    ring_FF_pr: {
      insert: "GF(7^3,'a')",
    },
    ring_QQ: {
      insert: "QQ",
    },
    ring_QQbar: {
      insert: "QQbar",
    },
    ring_QQp: {
      insert: "Qp(7)",
    },
    ring_RR: {
      insert: "RR",
    },
    ring_RDF: {
      insert: "RDF",
    },
    ring_RIF: {
      insert: "RIF",
    },
    ring_RLF: {
      insert: "RLF",
    },
    ring_ZZ: {
      insert: "ZZ",
    },
    ring_ZZp: {
      insert: "Zp(7)",
    },
    ring_QQx: {
      insert: "R.<x> = QQ[]",
    },
    ring_QQxyz: {
      insert: "R.<x,y,z> = QQ[]",
    },
    ring_ZZxp: {
      insert:
        "R = PolynomialRing(ZZ, ['x%s'%p for p in primes(100)])\nR.inject_variables()",
    },
    ring_QQ_quo: {
      insert: "R.<x,y> = QQ[]\nR.<xx, yy> = R.quo([y^2 - x^3 - x])",
    },
    interact_fx: {
      insert: `\
@interact
def interactive_function(a = slider(0, 10, .05, default=4),
                         b = (-3, 3, .1)):
    f(x) = b * x + sin(a * x)
    plot(f, (x, -5, 5)).show()\
`,
    },
    modes: {
      insert: "print('\\n'.join(modes()))",
    },
    jupyterkernels: {
      insert: "print(jupyter.available_kernels())",
    },
    mode_typeset: {
      insert: "%typeset_mode True\n",
    },
    mode_auto: {
      insert: "%auto",
    },
    mode_cython: {
      insert: "%cython\n",
    },
    mode_default_mode: {
      insert: "%default_mode r # change r to any mode\n",
    },
    mode_exercise: {
      insert: "%exercise\n",
    },
    mode_gap: {
      insert: "%gap\n",
    },
    mode_gp: {
      insert: "%gp\n",
    },
    mode_hide: {
      insert: "%hide\n",
    },
    mode_html: {
      insert: "%html\n",
    },
    mode_julia: {
      insert: "%julia\n",
    },
    mode_javascript: {
      insert: "%javascript\n/* Use print(...) for output */",
    },
    mode_jupyter_bridge: {
      insert: `\
a5 = jupyter("anaconda5")
# start new cells with %a5
# or set %default_mode a5\
`,
    },
    mode_md: {
      insert: "%md\n",
    },
    mode_octave: {
      insert: "%octave\n",
    },
    mode_python: {
      insert: "%python\n",
    },
    mode_python3: {
      insert: "%python3\n",
    },
    mode_anaconda: {
      insert: "%anaconda\n",
    },
    mode_r: {
      insert: "%r\n",
    },
    mode_scilab: {
      insert: "%scilab\n",
    },
    mode_sh: {
      insert: "%sh\n",
    },
    mode_time: {
      wrap: {
        left: "%time ",
        right: "",
      },
    },
    mode_timeit: {
      wrap: {
        left: "%timeit ",
        right: "",
      },
    },
    comment: {
      wrap: {
        left: "# ",
        right: "",
        multi: true,
        space: true,
      },
    },
    assign: {
      insert: "a = 5",
    },
    forloop: {
      insert: `\
for animal in ["dog", "cat", "mouse"]
    println("$animal is a mammal")
end\
`,
    },
    function: {
      insert: `\
function add(x, y)
    println("x is $x and y is $y")
    # Functions return the value of their last statement
    x + y
end

println(add(2000, 15))\
`,
    },
    ifelse: {
      insert: `\
a = 10
if a > 10
    println("a is bigger than 10.")
elseif a < 10    # This elseif clause is optional.
    println("a is smaller than 10.")
else             # The else clause is optional too.
    println("a is indeed 10.")
end\
`,
    },
  },

  r: {
    // http://cran.r-project.org/doc/manuals/r-release/R-intro.html
    comment: {
      wrap: {
        left: "#",
        right: "",
        multi: true,
        space: true,
      },
    },
    vector: {
      insert: "v <- c(1,1,2,3,5,8,13)",
    },
    forloop: {
      insert: `\
for (i in seq(1, 10, by=2)) {
    print(sprintf("i = %s", i));
}\
`,
    },
    ifelse: {
      insert: `\
k <- 10
if (k > 5) {
  print("k greater than 5")
} else {
  print("k less or equal than 5")
}\
`,
    },
    summary: {
      wrap: {
        left: "summary(",
        right: ")",
      },
    },
    plot: {
      insert: 'plot(c(1,2,4,8,16,32,64), c(1,1,2,3,5,8,13), type="l")',
    },
    seq: {
      insert: "-5:5",
    },
    seq_by: {
      insert: "seq(-5, 5, by=.2)",
    },
    seq_length: {
      insert: "seq(length=51, from=-5, by=.2)",
    },
    rep1: {
      insert: "rep(c(5,1,3), times = 3)",
    },
    rep2: {
      insert: "rep(c(5,1,3), each = 3)",
    },
    charvec: {
      insert: 'paste(c("X","Y"), 1:10, sep="")',
    },
    mean: {
      insert: "mean(c(4,3,4,2,-1,3,2,3,2))",
    },
    matrix: {
      insert: "array(1:20, dim=c(4,5))",
    },
    assign: {
      insert: `\
x <- "hello"
print(x)\
`,
    },
    outer: {
      insert: "c(1,2) %o% c(4,4)",
    },
    matrixmult: {
      insert: `\
x <- c(1,2,3,4)
A <- array(seq(1:20), dim=c(5,4))
A %*% x\
`,
    },
    function: {
      insert: `\
f <- function(x, y) {
   y <- 2 * x + y
   return(y + cos(x))
}
f(1,2)\
`,
    },
    inverse: {
      insert: "solve(array(c(2,1,-4,1), dim=c(2,2)))",
    },
    solvelin: {
      insert: "solve(array(c(2,1,-4,1), dim=c(2,2)), c(6,7))",
    },
    svd: {
      insert: "svd(array(-9:6, dim=c(4,4)))",
    },
    list1: {
      insert: `\
# index into a list via [[idx]]
l <- list(1,"fred", c(1,2,3))
print(l[[1]])
print(l[[2]])
print(l[[3]])\
`,
    },
    list2: {
      insert: `\
# assoziated list of names and objects
l <- list(a = 1, b = c(1,2,3))
print(l$a) # access a in l
print(l$b)\
`,
    },
    arrayselect: {
      insert: "x <- c(4,7,3,2,9)\nx[x > 4]",
    },
    dataframe: {
      insert: `\
a <- c(1,2,1)
b <- c("Fred", "Susan", "Joe")
c <- seq(1, by=.01, length=3)
df <- data.frame(sex = a, name = b, result = c)
df
# for more information: help(data.frame)\
`,
    },
    normal: {
      insert: "rnorm(10, mean = 100, sd = 1)",
    },
    stem: {
      insert:
        "# condensed overview of all numbers in the given list\nstem(rnorm(1000, mean = 5, sd = 10))",
    },
    defaultsize: {
      insert: "%sage r.set_plot_options(height=4, width=10)",
    },
    attach: {
      insert:
        "# attach loads internal datasets\nattach(faithful)\nprint(summary(faithful))\nprint(head(faithful))",
    },
    histdensity: {
      insert: `\
attach(faithful)
hist(eruptions, seq(1.6, 5.2, 0.2), prob=TRUE)
lines(density(eruptions, bw=0.1))
rug(eruptions)\
`,
    },
    qqplot: {
      insert: `\
attach(faithful)
long <- eruptions[eruptions > 3]
par(pty="s")   # square figure
qqnorm(long)
qqline(long)\
`,
    },
    boxplot: {
      insert: `\
a <- rnorm(10)
b <- rnorm(10, mean=2)
boxplot(a, b)\
`,
    },
    contour: {
      insert: `\
x <- seq(-pi, pi, len=50)
y <- x
f <- outer(x, y, function(x, y) cos(y)/(1 + x^2))
contour(x, y, f, nlevels=15)\
`,
    },
    lm: {
      insert: `\
y  <- c(0,3,2,2,4,5,8,9,7,6,2,0)
x1 <- c(1,2,3,4,3,4,5,7,5,7,8,9)
x2 <- c(1,1,1,1,2,2,2,3,3,3,4,4)
df <- data.frame(x1=x1, x2=x2)
model <-lm(y ~ x1 + x2, data=df)
model
summary(model)
anova(model)\
`,
    },
    nlm: {
      insert: `\
x <- c(0.02, 0.02, 0.06, 0.06, 0.11, 0.11, 0.22, 0.22, 0.56, 0.56,  1.10, 1.10)
y <- c(76, 47, 97, 107, 123, 139, 159, 152, 191, 201, 207, 200)
# function to be fitted
fn <- function(p) sum((y - (p[1] * x)/(p[2] + x))^2)
# supplying nlm with starting varlues
nlm(fn, p = c(200, 0.1), hessian = TRUE)\
`,
    },
  },
} as const;

/*
    fricas:
        help:
            wrap:
                insert : ")summary"
        explain:
             wrap:
                left  : ")display operation "
                right : ""
        differentiate:
            insert : 'differentiate(1 + x + x^2, x)'
        integrate:
            insert : 'integrate(1 + x + x^2, x)'
        nintegrate:
            insert : 'aromberg(sin, -%pi, %pi, 0.0001, 0.001, 2, 5, 20) -- aromberg(fn, a, b, epsrel, epsabs, nmin, nmax, nint)'
        'one-line function':
            insert : 'f(x,y) == x * sin(y)'
        matrix:
            insert : "matrix [[1,%pi],[3, %e],[5,6]]"
        vector:
            insert : "vector [%pi, 2, 3, %e]"
        factor:
            insert : "factor 2015"
        primes:
            insert : "primes(1,100)"
        mod:
            insert : "12::IntegerMod(5)"
        contfrac:
            insert : "continuedFraction(%e::Expression Float)$NumericContinuedFraction(Float)"
        determinant:
            insert : "determinant matrix [[1,2], [3,4]]"
        charpoly:
            insert : "characteristicPolynomial matrix [[1,2], [3,4]]"
        eigen:
            insert : "eigenvectors matrix [[1,2, 3], [4,5,6], [7,8,9]]"

        ring_CC:
            insert : "Polynomial Complex Float"
        ring_QQ:
            insert : "Polynomial Fraction Integer"
        ring_RR:
            insert : "Polynomial Float"
        ring_ZZ:
            insert : "Polynomial Integer"
        comment:
            wrap:
                left : "--"
                right: ""
                multi : true
                space : true
        assign:
            insert : "a: = 5"
        forloop:
            insert : """
                    for animal in ["dog", "cat", "mouse"] repeat
                        output("Mammal: ",animal)
                    """
        function :
            insert : """
                    plus(x, y) ==
                        output("x is ",x)
                        output("and y is ",y)
                        -- Functions return the value of their last statement
                        return x + y

                    output plus(2000, 15)
                    """
        ifelse:
            insert : """
                    a := 10
                    if a > 10 then
                        output("a is bigger than 10.")
                      else -- This elseif clause is optional.
                        if a < 10 then
                            output("a is smaller than 10.")
                          else -- The else clause is optional too.
                            output("a is indeed 10.")
                    """
*/

/*
Programmatically adding to above data structure
*/

// 6 markdown heading levels:
for (k = 1, i = k; k <= 6; k++, i = k) {
  const strip = (() => {
    const result: string[] = [];
    for (j = 1; j <= 6; j++) {
      if (j !== i) {
        result.push(`format_heading_${j}`);
      }
    }
    return result;
  })();
  const left =
    "\n" +
    (() => {
      let asc, end;
      const result1: string[] = [];
      for (
        j = 1, end = i, asc = 1 <= end;
        asc ? j <= end : j >= end;
        asc ? j++ : j--
      ) {
        result1.push("#");
      }
      return result1;
    })().join("") +
    " ";
  commands.md[`format_heading_${i}`] = {
    strip,
    wrap: {
      left,
      right: "",
    },
  };
}

/*
Programmatically creating the menu entries and buttons
*/

//
// helper functions
//

function make_bar(cls: string = "") {
  return $(`<span class='btn-group ${cls}'></span>`);
}

// this adds the content of a dropdown menu (basically, single or triple entries)
const add_menu = function (bar, entries) {
  const dropdown = $("<span class='btn-group'></span>");
  dropdown.append(
    $(`\
<span class="btn btn-default dropdown-toggle" data-toggle="dropdown" title="${entries[1]}">
 ${entries[0]} <b class="caret"></b>
</span>\
`),
  );

  const droplist = $("<ul class='dropdown-menu'></ul>");
  const divider = '<li class="divider"></li>';
  let first = true;
  for (let item of entries[2]) {
    var e;
    if (item.length === 1) {
      // new divider
      // don't show dividing line if it is at the very top
      let d = first ? "" : divider;
      d += `<li role="presentation" class="dropdown-header">${item[0]}</li>`;
      e = $(d);
    } else if ([2, 3].includes(item.length)) {
      // item in the menu
      let help = "";
      if (item.length === 3 && item[2].length > 0) {
        help = `data-toggle='tooltip' data-placement='right' title='${item[2]}'`;
      }
      e = $(`<li><a href='${item[1]}' ${help}>${item[0]}</a></li>`);
    }
    first = false;
    droplist.append(e);
  }

  dropdown.append(droplist);
  return bar.append(dropdown);
};

// this adds a single icon to the bar
function add_icon(bar, inner: string, href: string, comment: string) {
  let help = "";
  if (comment.length > 0) {
    help = `data-toggle='tooltip' data-placement='bottom' title='${comment}'`;
  }
  const icon = $(`<a href='${href}' class='btn btn-default' ${help}></a>`);
  icon.html(inner);
  return bar.append(icon);
}

//
// initializing and creating the menus
// this works in conjunction with editor.html
//

// Initialize fonts for the editor
const initialize_sagews_editor = function () {
  let item;
  const bar = $(".webapp-editor-codemirror-worksheet-editable-buttons");
  let elt = bar.find(".sagews-output-editor-font").find(".dropdown-menu");
  for (let font of "Serif,Sans,Arial,Arial Black,Courier,Courier New,Comic Sans MS,Georgia,Helvetica,Impact,Lucida Grande,Lucida Sans,Monaco,Palatino,Tahoma,Times New Roman,Verdana".split(
    ",",
  )) {
    item = $(`<li><a href='#fontName' data-args='${font}'>${font}</a></li>`);
    item.css("font-family", font);
    elt.append(item);
  }

  elt = bar.find(".sagews-output-editor-font-size").find(".dropdown-menu");
  for (let size = 1; size <= 7; size++) {
    item = $(
      `<li><a href='#fontSize' data-args='${size}'><font size=${size}>Size ${size}</font></a></li>`,
    );
    elt.append(item);
  }

  elt = bar.find(".sagews-output-editor-block-type").find(".dropdown-menu");
  for (i = 1; i <= 6; i++) {
    item = $(
      `<li><a href='#formatBlock' data-args='<H${i}>'><H${i} style='margin:0'>Heading</H${i}></a></li>`,
    );
    elt.append(item);
  }

  elt.prepend('<li role="presentation" class="divider"></li>');

  // trick so that data is retained even when editor is cloned:
  const args = JSON.stringify([
    null,
    { normalize: true, elementTagName: "code", applyToEditableOnly: true },
  ]);
  item = $(
    `<li><a href='#ClassApplier' data-args='${args}'><i class='fa fa-code'></i> <code>Code</code></a></li>`,
  );
  elt.prepend(item);

  elt.prepend('<li role="presentation" class="divider"></li>');
  item = $(`<li><a href='#removeFormat'><i class='fa fa-remove'></i> \
Normal</a></li>`);
  return elt.prepend(item);
};

// Initialize fonts for the editor
const initialize_md_html_editor = function () {
  let item;
  const bar = $(".webapp-editor-textedit-buttonbar");
  let elt = bar.find(".sagews-output-editor-font-face").find(".dropdown-menu");
  for (let font of FONT_FACES) {
    item = $(`<li><a href='#font_face' data-args='${font}'>${font}</a></li>`);
    item.css("font-family", font);
    elt.append(item);
  }

  elt = bar.find(".sagews-output-editor-font-size").find(".dropdown-menu");
  const v = [1, 2, 3, 4, 5, 6, 7];
  v.reverse();
  for (let size of v) {
    item = $(
      `<li><a href='#font_size' data-args='${size}'><font size=${size}>Size ${size} ${
        size === 3 ? "default" : ""
      }</font></a></li>`,
    );
    elt.append(item);
  }

  elt = bar.find(".sagews-output-editor-block-type").find(".dropdown-menu");
  for (i = 1; i <= 4; i++) {
    elt.append(
      $(
        `<li><a href='#format_heading_${i}'><H${i} style='margin:0'>Heading ${i}</H${i}></a></li>`,
      ),
    );
  }
  elt.append('<li role="presentation" class="divider"></li>');
  return elt.append(
    $(
      "<li><a href='#format_code'><i class='fa fa-code'></i> <code>Code</code></a></li>",
    ),
  );
};

// adding Python & Sage menu entries programmatically (editing HTML directly is too painful)
// FUTURE: make a general class for menu entries and hence use these functions for all menu entries?
const initialize_sage_python_r_toolbar = function () {
  // reference example, FUTURE: delete it
  `\
    <span class="btn-group">
        <span class="btn btn-default dropdown-toggle" data-toggle="dropdown" title="Control Structures">
            <i class="fa">Control</i> <b class="caret"></b>
        </span>
        <ul class="dropdown-menu">
            <li role="presentation" class="dropdown-header">Loops</li>
            <li><a href='#forloop' data-toggle="tooltip" data-placement="right" title="Iterate over a range of integers">For-Loop</a></li>
            <li><a href="#forlistloop">For-Loop over a list</a></li>
            <li class="divider"></li>
            <li role="presentation" class="dropdown-header">Decisions</li>
            <li><a href='#if'>If clause</a></li>
            <li><a href='#ifelse'>If-else clause</a></li>
            <li class="divider"></li>
            <li role="presentation" class="dropdown-header">Advanced</li>
            <li><a href="#cases">Cases</a></li>
            <li><a href='#forelseloop'>For-Else Loop</a></li>
        </ul>
    </span>
    <a href='#comment' class='btn btn-default' data-toggle="tooltip" data-placement="bottom" title="Comment selected code"><i class="fa">#</i></a>
</span>\
`;

  const codebar = $(".webapp-editor-codeedit-buttonbar");

  // -- modes (this isn't really code so weird to put here)
  const system_bar = make_bar("webapp-editor-codeedit-buttonbar-system");

  const help_list = [
    "<i class='fa fa-question-circle'></i> Help",
    "Sage Worksheet Help",
    [
      ["SageMath help"],
      ["Overview", "#sagemathdoc"],
      ["Tutorial", "#sagemathtutorial"],
      ["Reference", "#sagemathreference"],
      ["Keyboard shortcuts", "#sagemathkeyboardshortcuts"],
      ["Common syntax problems", "#sagesyntaxerrors"],
      ["Sage worksheet commands"],
      ["Worksheets in CoCalc", "#cocalcwiki"],
      ["I have a question about Sage", "#sagequestion"],
      ["General help", "#help"],
      ["Mode commands", "#modes"],
      ["Jupyter kernels", "#jupyterkernels"],
    ],
  ];
  add_menu(system_bar, help_list);

  const mode_list = [
    "Modes",
    "Sage Worksheet Modes",
    [
      ["General"],
      ["Auto execute cell on startup", "#mode_auto"],
      ["Hide input", "#mode_hide"],
      ["Set default mode", "#mode_default_mode"],
      ["Typeset output", "#mode_typeset"],
      ["Timing"],
      ["Benchmark code repeatedly", "#mode_timeit"],
      ["Time code once", "#mode_time"],
      ["Language modes"],
      ["Anaconda", "#mode_anaconda"],
      ["Cython", "#mode_cython"],
      ["Gap", "#mode_gap"],
      ["PARI/GP", "#mode_gp"],
      ["HTML", "#mode_html"],
      ["Javascript", "#mode_javascript"],
      ["Julia", "#mode_julia"],
      ["Jupyter bridge", "#mode_jupyter_bridge"],
      ["Markdown", "#mode_md"],
      ["Octave", "#mode_octave"],
      ["Python", "#mode_python"],
      ["Python 3", "#mode_python3"],
      ["R", "#mode_r"],
      ["Shell", "#mode_sh"],
    ],
  ];
  add_menu(system_bar, mode_list);

  //# MAYBE ADD THESE in another menu:
  //axiom
  //capture
  //coffeescript
  //command
  //file
  //fork
  //fortran
  //fricas
  //gap3
  //giac
  //go
  //hideall
  //javascript
  //kash
  //lie
  //lisp
  //load
  //macaulay2
  //maxima
  //octave
  //pandoc
  //perl
  //prun
  //reset
  //ruby
  //runfile
  //sage0
  //script
  //singular
  //typeset_mode
  //var
  //wiki
  //mode_list = ["More", "More Sage Worksheet Modes",
  //    [
  //      ["Axiom", "#mode_axiom"],
  //      ["Scilab", "#mode_scilab"],
  //      ["Shell script", "#mode_sh"],
  //      []
  //    ]]
  //add_menu(system_bar, mode_list)
  codebar.append(system_bar);

  // -- python specific --
  const pybar = make_bar("webapp-editor-codeedit-buttonbar-python");
  add_icon(pybar, "#", "#comment", "Comment selected text");

  let py_control = [
    "Data",
    "Basic Data Types",
    [
      ["Construction"],
      ["Dictionary", "#dict"],
      ["List", "#list"],
      ["List comprehension", "#list_comprehension"],
      ["Set", "#set"],
      ["Tuple", "#tuple"],
      ["Properties"],
      ["Length", "#len"],
      ["CSV"],
      ["Write CSV file", "#write_csv_file"],
      ["Read CSV file", "#read_csv_file"],
    ],
  ];
  add_menu(pybar, py_control);

  // structured dropdown menu data: button text, title info, list of ["button, "#id", "title help (optional)"]
  py_control = [
    "Control",
    "Control Structures",
    [
      ["Loops"],
      ["For-Loop", "#forloop", "Iterate over a range of integers"],
      ["For-Loop over a list", "#forlistloop", "Iterate over a list"],
      ["While loop", "#whileloop", "Loop while a condition holds"],
      ["Decisions"],
      ["If", "#if"],
      ["If-Else", "#ifelse"],
      ["Advanced"],
      ["Cases", "#cases", "Deciding between different cases"],
      [
        "For-Else Loop",
        "#forelseloop",
        "Searching for an item with a fallback.",
      ],
    ],
  ];
  add_menu(pybar, py_control);

  const py_func = [
    "Program",
    "Define Functions and Classes",
    [
      ["Functions"],
      ["Function", "#function", "Define a Python function"],
      ["Lambda", "#lambda", "A Python lambda function"],
      ["Classes"],
      ["Class", "#simple_class", "Define a simple class"],
      [
        "Class with inheritance",
        "#class_inheritance",
        "A class that inherits from other classes",
      ],
    ],
  ];

  add_menu(pybar, py_func);

  codebar.append(pybar);

  // -- Cython specific
  const cythonbar = make_bar("webapp-editor-codeedit-buttonbar-cython");
  const cython_classes = [
    "Cython Classes",
    "Define cdef'd Classes",
    [["cdef Class", "#cython_class", "Define a Cython class"]],
  ];
  add_menu(cythonbar, cython_classes);
  cythonbar.append(cythonbar);

  // -- sage specific --
  // we hide this bar on smaller screens to avoid the linebreak but still show the assistant
  // https://github.com/sagemathinc/cocalc/issues/4068
  // don't worry about xs, because then the whole bar is not visible (and replaced by one for mobile)
  // actually not: https://github.com/sagemathinc/cocalc/issues/6416
  const sagebar = make_bar("webapp-editor-codeedit-buttonbar-sage hidden-xs");

  const sage_calculus = [
    "Calculus",
    "Calculus",
    [
      ["&part; Differentiate", "#differentiate", "Differentiate a function"],
      [
        "&int; Numerical integral",
        "#nintegrate",
        "Numerically integrate a function",
      ],
      [
        "$f(x,y) = \\cdots $ - Symbolic Function",
        "#symbolic_function",
        "Define a symbolic function",
      ],
      ["&int; Symbolic integral", "#integrate", "Integrate a function"],
      ["Interact plots"],
      ["Interactive f(x)", "#interact_fx"],
    ],
  ];
  const sage_linalg = [
    "Linear",
    "Linear Algebra",
    [
      ["Matrix $M$", "#matrix", "Define a matrix"],
      ["Vector $\\vec v$", "#vector", "Define a vector"],
      ["Functions"],
      ["Characteristic polynomial", "#charpoly"],
      ["Determinant", "#det"],
      ["Eigenvectors", "#eigen", "Eigenvalues and eigenvectors of matrix"],
      ["SVD", "#svd", "Singular value decomposition of matrix"],

      ["Numpy"],
      ["Array", "#numpy_array"],
    ],
  ];
  const sage_plotting = [
    "Plots",
    "Plotting Graphics",
    [
      ["2D plotting"],
      ["Function", "#plot2d", "Plot f(x)"],
      ["Line", "#plot_line", "Sequence of line segments"],
      ["Parametric", "#plot_parametric", "Parematric plot"],
      ["Points", "#plot_points", "Plot many points"],
      ["Polygon", "#plot_polygon"],
      ["Random walk", "#plot_random_walk", "A random walk"],
      ["Text", "#plot_text", "Draw text"],
      ["3D plotting"],
      ["Cube", "#cube", "Show a colored cube"],
      ["Function", "#plot3d", "Plot f(x, y)"],
      ["Icosahedron", "#icosahedron"],
      ["Implicit plot", "#implicit_plot3d", "Create an implicit 3D plot"],
      ["Parametric curve", "#parametric_curve3d"],
      ["Parametric surface", "#parametric_surface"],
      ["Polytope", "#polytope"],
      ["Random walk", "#random_walk_3d", "A 3d Random Walk"],
      ["Tetrahedron", "#tetrahedron"],
      ["Text", "#plot_text3d", "Draw text"],
      ["Torus", "#plot_torus"],
    ],
  ];
  const sage_graphs = [
    "Graphs",
    "Graph theory",
    [
      ["graphs.&lt;tab&gt;", "#graphs"],
      ["Petersen graph", "#petersen", "Define the Peterson graph"],
      ["Random graph", "#random_graph"],
      ["Invariants"],
      [
        "Automorphism group",
        "#auto_group_graph",
        "Automorphism group of a graph",
      ],
      ["Chromatic number", "#chromatic_number", "Chromatic number of a graph"],
      ["Visualization"],
      ["2D plot", "#graph_2dplot"],
      ["3D plot", "#graph_3dplot"],
    ],
  ];
  const sage_nt = [
    "Numbers",
    "Number theory",
    [
      [
        "Binary quadratic form",
        "#binary_quadform",
        "Define a binary quadratic form",
      ],
      ["Continued fraction", "#contfrac", "Compute a continued fraction"],
      ["Elliptic curve", "#ellcurve", "Define an elliptic curve"],
      ["Factor", "#factor", "Factorization of something"],
      ["Mod $n$", "#mod", "Number modulo n"],
      ["List prime numbers", "#primes", "Enumerate prime numbers"],
      ["Count prime numbers", "#prime_pi", "Count prime numbers"],
    ],
  ];

  const sage_rings = [
    "Rings",
    "Rings and fields",
    [
      ["$\\CC$ - Complex numbers", "#ring_CC"],
      ["$\\QQ$ - Rational numbers", "#ring_QQ"],
      ["$\\RR$ - Real numbers", "#ring_RR"],
      ["$\\ZZ$ - Integers", "#ring_ZZ"],
      ["Polynomial rings"],
      ["$\\QQ[x, y, z]$", "#ring_QQxyz"],
      ["$\\QQ[x, y]/(y^2-x^3-x)$", "#ring_QQ_quo"],
      ["$\\ZZ[x_2, x_3, \\ldots, x_{97}]$", "#ring_ZZxp"],
      ["Advanced rings"],
      ["$\\mathbb{A}$ - Algebraic reals", "#ring_AA"],
      ["$\\CDF$ - Complex double", "#ring_CDF"],
      ["$\\CC$ - Complex interval", "#ring_CIF"],
      ["$\\CLF$ - Complex lazy", "#ring_CLF"],
      ["$\\FF_p$ - Prime finite field", "#ring_FF_p"],
      ["$\\FF_{p^r}$ - finite field", "#ring_FF_pr"],
      ["$\\overline{\\QQ}$ - Algebraic closure", "#ring_QQbar"],
      ["$\\QQ_p$ - $p$-adic numbers", "#ring_QQp"],
      ["$\\RDF$ - Real double", "#ring_RDF"],
      ["$\\RR$ - Real interval", "#ring_RIF"],
      ["$\\RLF$ - Real lazy", "#ring_RLF"],
      ["$\\ZZ_p$ - $p$-adic integers", "#ring_ZZp"],
    ],
  ];

  add_icon(sagebar, "$x$", "#var", "Define a symbolic variable");
  add_menu(sagebar, sage_plotting);
  add_menu(sagebar, sage_calculus);
  add_menu(sagebar, sage_linalg);
  add_menu(sagebar, sage_graphs);
  add_menu(sagebar, sage_nt);
  add_menu(sagebar, sage_rings);

  codebar.append(sagebar);

  // -- r specific --
  const rbar = $(".webapp-editor-redit-buttonbar");

  const r_basic = make_bar();
  add_icon(r_basic, "#", "#comment", "Comment selected text");
  add_icon(r_basic, "$\\vec v$", "#vector", "Insert a vector");

  const r_control = make_bar();
  const r_control_entries = [
    "Control",
    "Control structures",
    [
      ["Assignment", "#assign", "Give an object a (variable)name"],
      ["For-Loop", "#forloop", "Insert a for loop"],
      ["Function definition", "#function", "Define a function"],
      ["If-Else", "#ifelse"],
    ],
  ];
  add_menu(r_control, r_control_entries);

  const r_data = make_bar();
  const r_data_entries = [
    "Data",
    "Data structures",
    [
      ["List, indexed", "#list1"],
      ["List, associative", "#list2"],
      ["Array selection", "#arrayselect"],
      ["Data frame", "#dataframe"],
      ["Attach", "#attach"],
    ],
  ];
  add_menu(r_data, r_data_entries);

  const r_funcs = make_bar();
  const r_funcs_entries = [
    "Functions",
    "Some selected functions",
    [
      ["Sequence simple", "#seq"],
      ["Sequence stepsize", "#seq_by"],
      ["Sequence length", "#seq_length"],
      ["Repetitions (times)", "rep1"],
      ["Repetitions (each)", "rep2"],
      ["Character vector", "#charvec"],
      ["Matrix array", "#matrix"],
      ["Matrix multipliation", "#matrixmult"],
      ["Outer product", "#outer"],
      ["Inverse matrix", "#inverse"],
      ["Solve A*x=b", "#solvelin"],
      ["SVD", "#svd"],
    ],
  ];
  add_menu(r_funcs, r_funcs_entries);

  const r_stats = make_bar();
  const r_stats_entries = [
    "Stats",
    "Basic statistical functions",
    [
      ["Statistical summary", "#summary"],
      ["Mean", "#mean"],
      ["Normal distribution", "#normal"],
      ["Linear model", "#lm"],
      ["Nonlinear model", "#nlm"],
    ],
  ];
  add_menu(r_stats, r_stats_entries);

  const r_plot = make_bar();
  const r_plot_entries = [
    "Plots",
    "Basic plots",
    [
      ["Plot x/y pairs", "#plot"],
      ["Stem plot", "#stem"],
      ["Histogram + Density + Rug", "#histdensity"],
      ["QQ-Plot", "#qqplot", "Quantile-quantile plot"],
      ["Boxplot", "#boxplot"],
      ["Contour plot", "#contour"],
      ["Change default plot size", "#defaultsize"],
    ],
  ];
  add_menu(r_plot, r_plot_entries);

  rbar.append(r_basic);
  rbar.append(r_control);
  rbar.append(r_data);
  rbar.append(r_funcs);
  rbar.append(r_stats);
  rbar.append(r_plot);

  // -- Julia specific --
  const julia_bar = $(".webapp-editor-julia-edit-buttonbar");

  const julia_basic = make_bar();
  add_icon(julia_basic, "#", "#comment", "Comment selected text");

  const julia_control = make_bar();
  const julia_control_entries = [
    "Control",
    "Control structures",
    [
      ["Assignment", "#assign", "Give an object a (variable)name"],
      ["For-Loop", "#forloop", "Insert a for loop"],
      ["Function definition", "#function", "Define a function"],
      ["If-Else", "#ifelse"],
    ],
  ];
  add_menu(julia_control, julia_control_entries);
  julia_bar.append(julia_basic);
  julia_bar.append(julia_control);

  // -- sh specific --
  const sh_bar = $(".webapp-editor-sh-edit-buttonbar");

  const sh_git = make_bar();
  const sh_git_entries = [
    "Git",
    "Basic Git commands",
    [
      ["Set name and email", "#set_name_and_email", "Set name and email"],
      ["Initalize Git", "#initalize_git", "Initalize Git"],
      ["Create an ignore file", "#create_gitignore", "Create an ignore file"],
      ["Clone a local repo", "#clone_local_repo", "Clone local repo"],
      ["Clone a remote repo", "#clone_remote_repo", "Clone remote repo"],
      ["Add a file to repo", "#add_file_to_repo", "Add file to the repo"],
      [
        "Add all files to repo",
        "#add_all_to_repo",
        "Add all not ignored files to the repo",
      ],
      [
        "See changes before committing",
        "#diff",
        "See changes before committing",
      ],
      ["Commit your changes", "#commit", "Commit all your changes"],
      ["Setup SSH for Github", "#setup_ssh_for_github", "Setup SSH for Github"],
      [
        "Push changes",
        "#push_origin_master",
        "Push changes to the master branch of your remote repository",
      ],
      ["Status", "#status", "Status"],
      ["Add remote repo", "#add_remote_repo", "Connect to a remote repository"],
      [
        "List remote repos",
        "#list_remote_repos",
        "List all currently configured remote repositories",
      ],
      [
        "Create a new branch",
        "#create_new_branch",
        "Create a new branch and switch to it",
      ],
      [
        "Switch branches",
        "#switch_branches",
        "Switch from one branch to another",
      ],
      [
        "List branches",
        "#list_branches",
        "List all the branches in your repo, and also tell you what branch you're currently in",
      ],
      [
        "Delete the feature branch",
        "#delete_the_feature_branch",
        "Delete the feature branch",
      ],
      [
        "Push branch",
        "#push_branch",
        "Push the branch to your remote repository, so others can use it",
      ],
      [
        "Push all branches",
        "#push_all_branches",
        "Push all branches to your remote repository",
      ],
      [
        "Delete remote branch",
        "#delete_remote_branch",
        "Delete a branch on your remote repository",
      ],
      [
        "Update repo",
        "#pull",
        "Update from the remote repository Fetch and merge changes on the remote server to your working directory",
      ],
      [
        "Merge a branch",
        "#merge_branch",
        "To merge a different branch into your active branch",
      ],
      ["Show history", "#show_history", "Show the history of previous commits"],
      ["Undo local changes", "#undo_local_changes", "Undo local changes"],
      [
        "Get rid of local changes",
        "#get_rid_of_local_changes",
        "Drop all your local changes and commits, fetch the latest history from the server and point your local master branch at it",
      ],
      [
        "Search the working directory for foo()",
        "#search_for",
        "Search the working directory for foo()",
      ],
    ],
  ];
  add_menu(sh_git, sh_git_entries);
  return sh_bar.append(sh_git);
};

// error since not yet used.
// @ts-expect-error
function initialize_latex_buttonbar() {
  const latexbar = make_bar();
  add_icon(
    latexbar,
    "<i class='fa fa-comment'></i>",
    "#comment",
    "Comment selected text",
  );

  const templates = [
    "Templates",
    "These templates come exclusively on top",
    [
      ["Article", "#article"],
      ["KOMA Script"],
      ["Article", "#scrartcl"],
      ["Report", "#scrreprt"],
    ],
  ];
  add_menu(latexbar, templates);

  // FUTURE: merge this with the usual text formatting toolbar, such that its list of actions is inserted here
  // IDEA: maybe, clicking on the "Format" dropdown shows the cloned formatting toolbar?
  //text = ["Format", "Text formatting",[]]
  //add_menu(latexbar, text)
  const formatting = $("<span class='btn-group'></span>");
  formatting.append(
    $(`\
<span class="btn btn-default dropdown-toggle" data-toggle="dropdown" title="Text Formatting">
 <i class="fa">Format</i> <b class="caret"></b>
</span>\
`),
  );
  const format_buttons = $(
    ".webapp-editor-codemirror-worksheet-editable-buttons",
  ).clone();
  format_buttons.addClass("dropdown-menu");
  format_buttons.removeClass("hide");
  format_buttons.css("min-width", 300);
  formatting.append(format_buttons);
  latexbar.append(formatting);
  // end format button idea

  const formulas = [
    "Formula",
    "These are some standard formuas",
    [
      ["$x^2$", "#xsquare"],
      ["$\\int$", "#integral"],
      ["Environment"],
      ["Cases", "#cases"],
    ],
  ];
  add_menu(latexbar, formulas);

  const bb = $(".webapp-editor-latex-buttonbar");
  return bb.append(latexbar);
}

// NOT READY YET.
//initialize_latex_buttonbar()

// must get called before using the button bars.
export function init_buttonbars() {
  initialize_sagews_editor();
  initialize_md_html_editor();
  return initialize_sage_python_r_toolbar();
}
