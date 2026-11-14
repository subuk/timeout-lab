// Command schema generates the public model's structural JSON Schema from Go types.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"reflect"
	"strings"

	"timeoutlab/core"
)

type schema = map[string]any

type generator struct{ defs map[string]schema }

func (g *generator) describe(t reflect.Type) schema {
	if t.Kind() == reflect.Pointer {
		return schema{"anyOf": []schema{g.describe(t.Elem()), {"type": "null"}}}
	}
	switch t.Kind() {
	case reflect.Struct:
		name := t.Name()
		if _, exists := g.defs[name]; !exists {
			g.defs[name] = schema{} // Register before descending into recursive resources.
			properties := map[string]schema{}
			required := []string{}
			g.fields(t, properties, &required)
			definition := schema{"type": "object", "properties": properties, "additionalProperties": false}
			if len(required) > 0 {
				definition["required"] = required
			}
			g.defs[name] = definition
		}
		return schema{"$ref": "#/$defs/" + name}
	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			panic("JSON object requires string keys: " + t.String())
		}
		return schema{"type": "object", "additionalProperties": g.describe(t.Elem())}
	case reflect.Slice:
		return schema{"type": "array", "items": g.describe(t.Elem())}
	case reflect.String:
		return schema{"type": "string"}
	case reflect.Bool:
		return schema{"type": "boolean"}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return schema{"type": "integer"}
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return schema{"type": "integer", "minimum": 0}
	case reflect.Float32, reflect.Float64:
		return schema{"type": "number"}
	default:
		panic("Unsupported JSON schema type: " + t.String())
	}
}

func (g *generator) fields(t reflect.Type, properties map[string]schema, required *[]string) {
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() {
			continue
		}
		tag := strings.Split(field.Tag.Get("json"), ",")
		if tag[0] == "-" {
			continue
		}
		if field.Anonymous && tag[0] == "" {
			g.fields(field.Type, properties, required)
			continue
		}
		name := tag[0]
		if name == "" {
			name = field.Name
		}
		if _, exists := properties[name]; exists {
			panic("Conflicting JSON field: " + name)
		}
		properties[name] = g.describe(field.Type)
		optional := false
		for _, option := range tag[1:] {
			optional = optional || option == "omitempty"
		}
		if !optional {
			*required = append(*required, name)
		}
	}
}

func modelSchema() schema {
	g := generator{defs: map[string]schema{}}
	root := g.describe(reflect.TypeFor[core.Config]())
	root["$schema"] = "https://json-schema.org/draft/2020-12/schema"
	root["$id"] = "https://tmlab.krglv.com/schema.json"
	root["title"] = "Timeout Lab model"
	root["description"] = "Generated from Go configuration types. Non-omitempty fields are required for complete authored models. Collections must be arrays/objects; optional pointers also accept null. This structural schema does not replace engine validation of ranges, enums, references, graph constraints or simulation rules. Durations are in milliseconds."
	root["$defs"] = g.defs
	return root
}

func main() {
	output := flag.String("out", "public/schema.json", "output schema path")
	fixtures := flag.Bool("fixtures", false, "print engine-validated presets for schema tests")
	flag.Parse()
	if *fixtures {
		models := map[string]core.Config{}
		for _, id := range []string{"normal", "slow", "fanout", "hang", "autoscale", "az", "numa", "composition"} {
			c, err := core.PresetConfig(id)
			if err != nil {
				panic(err)
			}
			if err := core.Validate(c); err != nil {
				panic(err)
			}
			models[id] = c
		}
		if err := json.NewEncoder(os.Stdout).Encode(models); err != nil {
			panic(err)
		}
		return
	}
	data, err := json.MarshalIndent(modelSchema(), "", "  ")
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(*output, append(data, '\n'), 0644); err != nil {
		panic(err)
	}
	fmt.Println("Generated " + *output)
}
