import { getDeep, setDeep } from './accessDeep';
import { isPrimitive } from './is';
import * as IteratorUtils from './iteratorutils';
import {
  StringifiedPath,
  isStringifiedPath,
  parsePath,
  stringifyPath,
} from './pathstringifier';
import { Walker } from './plainer';
import {
  TypeAnnotation,
  isTypeAnnotation,
  transformValue,
  untransformValue,
} from './transformer';

export interface Annotations {
  root?: TypeAnnotation;
  values?: Record<StringifiedPath, TypeAnnotation>;
  referentialEqualities?: Record<StringifiedPath, StringifiedPath[]>;
  referentialEqualitiesRoot?: StringifiedPath[];
}

export function isAnnotations(object: any): object is Annotations {
  try {
    if (!!object.root && !isTypeAnnotation(object.root)) {
      return false;
    }

    if (!!object.values) {
      return Object.entries(object.values).every(
        ([key, value]) => isStringifiedPath(key) && isTypeAnnotation(value)
      );
    }

    if (!!object.referentialEqualities) {
      return Object.entries(object.referentialEqualities).every(
        ([key, value]) =>
          isStringifiedPath(key) && (value as string[]).every(isStringifiedPath)
      );
    }

    return true;
  } catch (error) {
    return false;
  }
}

export const makeAnnotator = () => {
  const annotations: Annotations = {};

  const objectIdentities = new Map<any, any[][]>();
  function registerObjectPath(object: any, path: any[]) {
    const paths = objectIdentities.get(object) ?? [];
    paths.push(path);
    objectIdentities.set(object, paths);
  }

  const annotator: Walker = ({ path, node }) => {
    if (!isPrimitive(node)) {
      registerObjectPath(node, path);
    }

    const transformed = transformValue(node);

    if (transformed) {
      if (path.length === 0) {
        annotations.root = transformed.type;
      } else {
        if (!annotations.values) {
          annotations.values = {};
        }

        annotations.values[stringifyPath(path)] = transformed.type;
      }

      return transformed.value;
    } else {
      return node;
    }
  };

  function getAnnotations(): Annotations {
    IteratorUtils.forEach(objectIdentities.values(), paths => {
      if (paths.length > 1) {
        const [shortestPath, ...identityPaths] = paths
          .sort((a, b) => a.length - b.length)
          .map(stringifyPath);

        const isRoot = shortestPath.length === 0;
        if (isRoot) {
          annotations.referentialEqualitiesRoot = identityPaths;
        } else {
          if (!annotations.referentialEqualities) {
            annotations.referentialEqualities = {};
          }

          annotations.referentialEqualities[shortestPath] = identityPaths;
        }
      }
    });

    return annotations;
  }

  return { getAnnotations, annotator };
};

export const applyAnnotations = (plain: any, annotations: Annotations): any => {
  if (annotations.values) {
    const annotationsWithPaths = Object.entries(annotations.values).map(
      ([key, type]) => [parsePath(key), type] as [string[], TypeAnnotation]
    );

    const annotationsWithPathsLeavesToRoot = annotationsWithPaths.sort(
      ([pathA], [pathB]) => pathB.length - pathA.length
    );

    for (const [path, type] of annotationsWithPathsLeavesToRoot) {
      plain = setDeep(plain, path, v =>
        untransformValue(v, type as TypeAnnotation)
      );
    }
  }

  if (annotations.root) {
    plain = untransformValue(plain, annotations.root);
  }

  if (annotations.referentialEqualities) {
    for (const [objectPath, identicalObjectsPaths] of Object.entries(
      annotations.referentialEqualities
    )) {
      const object = getDeep(plain, parsePath(objectPath));

      for (const identicalObjectPath of identicalObjectsPaths.map(parsePath)) {
        setDeep(plain, identicalObjectPath, () => object);
      }
    }
  }

  if (annotations.referentialEqualitiesRoot) {
    for (const identicalObjectPath of annotations.referentialEqualitiesRoot.map(
      parsePath
    )) {
      setDeep(plain, identicalObjectPath, () => plain);
    }
  }

  return plain;
};