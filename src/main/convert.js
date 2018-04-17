/*
 * MIT License
 *
 * Copyright (c) 2017 Uber Node.js
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// @flow

import {Thrift} from 'thriftrw';
import {TypeConverter} from './types';
import prettier from 'prettier';
import path from 'path';

import type {Base} from 'bufrw';
import type {Struct, Field, Enum, Typedef, FunctionDefinition, Service, Const} from 'thriftrw/ast';

const thriftOptions = {
  strict: false,
  allowFilesystemAccess: true,
  allowOptionalArguments: true
};

export class ThriftFileConverter {
  thriftPath: string;
  thrift: Thrift;
  types: TypeConverter;
  transformName: string => string;
  enumvalues: boolean;
  withsource: boolean;

  constructor(thriftPath: string, transformName: string => string, enumvalues: boolean, withsource: boolean) {
    this.thriftPath = path.resolve(thriftPath);
    this.thrift = new Thrift({...thriftOptions, entryPoint: thriftPath});
    this.transformName = transformName;
    this.types = new TypeConverter(transformName);
    this.enumvalues = enumvalues;
    this.withsource = withsource;
  }

  generateFlowFile = () =>
    prettier.format(
      [
        '// @flow',
        `// Generated by thrift2flow at ${new Date().toString()}${
          this.withsource ? `\n// Source: ${this.thriftPath}` : ''}`,
        this.generateImports(),
        ...this.thrift.asts[this.thrift.filename].definitions.map(this.convertDefinitionToCode)
      ]
        .filter(Boolean)
        .join('\n\n'),
      {parser: 'flow'}
    );

  convertDefinitionToCode = (def: any) => {
    switch (def.type) {
      case 'Struct':
      case 'Exception':
        return this.generateStruct(def);
      case 'Union':
        return this.generateUnion(def);
      case 'Enum':
        return this.generateEnum(def);
      case 'Typedef':
        return this.generateTypedef(def);
      case 'Service':
        return this.generateService(def);
      case 'Const':
        return this.generateConst(def);
      default:
        console.warn(
          `${path.basename(this.thriftPath)}: Skipping ${def.type} ${def.id ? def.id.name : '?'}`
        );
        return null;
    }
  };

  generateService = (def: Service) =>
    `export type ${this.transformName(def.id.name)} = {\n${def.functions
      .map(this.generateFunction)
      .join(',')}};`;

  generateFunction = (fn: FunctionDefinition) =>
    `${fn.id.name}: (${
      fn.fields.length ? this.generateStructContents([...fn.fields]) : ''
    }) => ${this.types.convert(fn.returns)}`;

  generateTypedef = (def: Typedef) =>
    `export type ${this.transformName(def.id.name)} = ${this.types.convert(def.valueType)};`;

  generateEnumValues = (def: Enum) =>
    `${def.definitions.map((d, index) => `${d.value ? d.value.value : index}`).join(' | ')}`;

  generateEnumKeys = (def: Enum) => `${def.definitions.map(d => `"${d.id.name}"`).join(' | ')};`;

  generateEnum = (def: Enum) => {
    if (this.enumvalues) {
      return `export type ${this.transformName(def.id.name)} = ${this.generateEnumValues(def)};
       export type ${this.transformName(def.id.name)}Keys = ${this.generateEnumKeys(def)};`;
    }

    return `export type ${this.transformName(def.id.name)}Values = ${this.generateEnumValues(
      def
    )};
      export type ${this.transformName(def.id.name)} = ${this.generateEnumKeys(def)};`;
  };

  generateConst = (def: Const) => {
    // string values need to be in quotes
    const value = typeof def.value.value === 'string' ? `'${def.value.value}'` : def.value.value;
    return `export const ${this.transformName(def.id.name)}: ${this.types.convert(def.fieldType)} = ${value};`;
  }

  generateStruct = ({id: {name}, fields}: Struct) =>
    `export type ${this.transformName(name)} = ${this.generateStructContents(fields)};`;

  generateStructContents = (fields: Object) =>
    `{|${Object.values(fields)
      .map(
        (f: Base) =>
          `${f.name}${this.isOptional(f) ? '?' : ''}: ${this.types.convert(f.valueType)};`
      )
      .join('\n')}|}`;

  generateUnion = ({id: {name}, fields}: Struct) =>
    `export type ${this.transformName(name)} = ${this.generateUnionContents(fields)};`;

  generateUnionContents = (fields: Object) => {
    if (!fields.length) {
      return '{||}';
    }
    return Object.values(fields)
      .map((f: Base) => {
        return `{|${f.name}: ${this.types.convert(f.valueType)}|}`;
      })
      .join(' | ');
  };

  isOptional = (field: Field) => field.optional;

  generateImports = () =>
    this.getImportAbsPaths()
      .filter(p => p !== this.thriftPath)
      .map(p =>
        path.join(
          path.dirname(path.relative(path.dirname(this.thriftPath), p)),
          path.basename(p, '.thrift')
        )
      )
      .map(p => (p.indexOf('/') === -1 ? `./${p}` : p))
      .map(relpath => `import * as ${path.basename(relpath)} from '${relpath}.js';`)
      .join('\n');

  getImportAbsPaths = () => Object.keys(this.thrift.idls).map(p => path.resolve(p));
}
