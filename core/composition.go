package core

// CompositionConfig demonstrates nested callers, sibling resources, parallel
// downstream work and two request paths without introducing physical box types.
func CompositionConfig() Config {
	c := DefaultConfig()
	c.Name = "Nested boxes · request paths"
	c.Description = "Read and write tags select different downstream boxes. Each backend contains an application and CPU; CPU calls its own memory box. Application and CPU share the same queue-and-worker mechanism."
	c.I18n = Localizations{"ru": {Name: "Вложенные ящики · пути запросов", Description: "Теги read и write выбирают разные ящики ниже по графу. В каждом бекенде есть приложение и CPU; CPU вызывает собственный ящик памяти. Приложение и CPU используют один механизм очередей и воркеров."}}
	c.RPS = 80
	c.RequestTag = &TagGenerator{Key: "op", A: "read", B: "write", Percent: 70}
	api := &c.Groups[1]
	api.Count, api.Workers, api.Service = 2, 16, 0
	api.Resources = []ResourceConfig{
		{ID: "app", Name: "Application", I18n: Localizations{"ru": {Name: "Приложение"}}, Scope: "instance", Workers: 8, Service: 1, QueueLimit: 500,
			Stages: []Stage{{Calls: []Call{{Resource: "../compute", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}, {Join: "all", Calls: []Call{
				{Target: "cache", Calls: 1, Route: "round_robin", Transport: "ideal", When: map[string]string{"op": "read"}},
				{Target: "db", Calls: 1, Route: "round_robin", When: map[string]string{"op": "write"}, Transport: "network"},
				{Target: "audit", Calls: 1, Route: "round_robin", Transport: "network"},
			}}, {Calls: []Call{{Resource: "../compute", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}},
		{ID: "compute", Name: "CPU", Scope: "instance", Workers: 2, Service: 4, QueueLimit: 500,
			Resources: []ResourceConfig{{ID: "memory", Name: "Memory", I18n: Localizations{"ru": {Name: "Память"}}, Scope: "instance", Workers: 2, Service: 2, QueueLimit: 500, Stages: []Stage{}}}, Stages: []Stage{{Calls: []Call{{Resource: "memory", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}},
		},
	}
	api.Stages = []Stage{{Calls: []Call{{Resource: "app", Calls: 1, Route: "round_robin", Transport: "ideal", Timeout: new(float64)}}, Join: "all"}}
	c.Groups = append(c.Groups,
		Group{ID: "cache", Name: "Cache", I18n: Localizations{"ru": {Name: "Кеш"}}, Count: 1, Workers: 16, Service: 2, Timeout: 500, ConnectTimeout: 100, QueueLimit: 500, Stages: []Stage{}},
		Group{ID: "audit", Name: "Audit", I18n: Localizations{"ru": {Name: "Аудит"}}, Count: 1, Workers: 16, Service: 3, Timeout: 500, ConnectTimeout: 100, QueueLimit: 500, Stages: []Stage{}})
	return c
}
