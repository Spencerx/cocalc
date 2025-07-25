import React from "react";
import { useRef } from "react";
const getDirection = require("direction");
import { Editor, Node, Range, Element as SlateElement } from "slate";

import Text from "./text";
import Children from "./children";
import { ReactEditor, useSlateStatic, useReadOnly } from "..";
import { SelectedContext } from "../hooks/use-selected";
import { useIsomorphicLayoutEffect } from "../hooks/use-isomorphic-layout-effect";
import {
  NODE_TO_ELEMENT,
  ELEMENT_TO_NODE,
  NODE_TO_PARENT,
  NODE_TO_INDEX,
  KEY_TO_ELEMENT,
} from "../utils/weak-maps";
import { RenderElementProps, RenderLeafProps } from "./editable";

/**
 * Element.
 */

const Element = (props: {
  decorations: Range[];
  element: SlateElement;
  renderElement?: React.FC<RenderElementProps>;
  renderLeaf?: React.FC<RenderLeafProps>;
  selection: Range | null;
}) => {
  const {
    decorations,
    element,
    renderElement = (p: RenderElementProps) => <DefaultElement {...p} />,
    renderLeaf,
    selection,
  } = props;
  // console.log("renderElement", element);

  const ref = useRef<HTMLElement>(null);
  const editor = useSlateStatic();
  const readOnly = useReadOnly();
  const key = ReactEditor.findKey(editor, element);

  // Update element-related weak maps with the DOM element ref.
  useIsomorphicLayoutEffect(() => {
    if (ref.current) {
      KEY_TO_ELEMENT.set(key, ref.current);
      NODE_TO_ELEMENT.set(element, ref.current);
      ELEMENT_TO_NODE.set(ref.current, element);
    } else {
      KEY_TO_ELEMENT.delete(key);
      NODE_TO_ELEMENT.delete(element);
    }
  });

  const isInline = editor.isInline(element);

  let children: React.JSX.Element | null = (
    <Children
      decorations={decorations}
      node={element}
      renderElement={renderElement}
      renderLeaf={renderLeaf}
      selection={selection}
    />
  );

  // Attributes that the developer must mix into the element in their
  // custom node renderer component.
  const attributes: {
    "data-slate-node": "element";
    "data-slate-void"?: true;
    "data-slate-inline"?: true;
    contentEditable?: false;
    dir?: "rtl";
    ref: any;
  } = {
    "data-slate-node": "element",
    ref,
  };

  if (isInline) {
    attributes["data-slate-inline"] = true;
  }

  // If it's a block node with inline children, add the proper `dir` attribute
  // for text direction.
  if (!isInline && Editor.hasInlines(editor, element)) {
    const text = Node.string(element);
    const dir = getDirection(text);

    if (dir === "rtl") {
      attributes.dir = dir;
    }
  }

  // If it's a void node, wrap the children in extra void-specific elements.
  if (Editor.isVoid(editor, element)) {
    attributes["data-slate-void"] = true;

    if (!readOnly && isInline) {
      attributes.contentEditable = false;
    }

    const Tag = isInline ? "span" : "div";
    const [[text]] = Node.texts(element);

    children = readOnly ? null : (
      <Tag
        data-slate-spacer
        style={{
          height: "0",
          color: "transparent",
          outline: "none",
          position: "absolute",
        }}
      >
        <Text decorations={[]} isLast={false} parent={element} text={text} />
      </Tag>
    );

    NODE_TO_INDEX.set(text, 0);
    NODE_TO_PARENT.set(text, element);
  }

  return (
    <SelectedContext.Provider value={!!selection}>
      {React.createElement(renderElement, { attributes, children, element })}
    </SelectedContext.Provider>
  );
};

const MemoizedElement = React.memo(Element, (prev, next) => {
  const is_equal =
    prev.element === next.element &&
    prev.renderElement === next.renderElement &&
    prev.renderLeaf === next.renderLeaf &&
    isRangeListEqual(prev.decorations, next.decorations) &&
    (prev.selection === next.selection ||
      (!!prev.selection &&
        !!next.selection &&
        Range.equals(prev.selection, next.selection)));
  // console.log("MemoizedElement", { is_equal, prev, next });
  return is_equal;
});

/**
 * The default element renderer.
 */

export const DefaultElement = (props: RenderElementProps) => {
  const { attributes, children, element } = props;
  const editor = useSlateStatic();
  const Tag = editor.isInline(element) ? "span" : "div";
  return (
    <Tag {...attributes} style={{ position: "relative" }}>
      {children}
    </Tag>
  );
};

/**
 * Check if a list of ranges is equal to another.
 *
 * PERF: this requires the two lists to also have the ranges inside them in the
 * same order, but this is an okay constraint for us since decorations are
 * kept in order, and the odd case where they aren't is okay to re-render for.
 */

const isRangeListEqual = (list?: Range[], another?: Range[]): boolean => {
  if (list == null || another == null) {
    return list === another;
  }
  if (list.length !== another.length) {
    return false;
  }

  for (let i = 0; i < list.length; i++) {
    const range = list[i];
    const other = another[i];

    if (!Range.equals(range, other)) {
      return false;
    }
  }

  return true;
};

export default MemoizedElement;
