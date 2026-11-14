package core

import "fmt"

// PresetConfig is the single source for every built-in experiment. Faults are
// part of the configuration, so exporting a preset preserves its starting state.
func PresetConfig(id string) (Config, error) {
	c := DefaultConfig()
	switch id {
	case "normal":
	case "slow":
		c.Groups[2].Resources[1].Service = 600
	case "fanout":
		c.Name = "Three database calls per request"
		c.Description = "Each API sends three parallel database calls per user request and waits for all three responses. Initially, 200 incoming requests/s imply 600 database calls/s before capacity limits, and disk work is set to 50 ms per visit. Watch the database queue grow and the API and load balancer workers wait for downstream responses."
		c.I18n = Localizations{"ru": {Name: "Три вызова БД на один запрос", Description: "На один пользовательский запрос API делает три параллельных вызова базы и ждёт все три ответа. Начальные настройки: 200 запросов/с на входе — номинально 600 вызовов БД/с до ограничения пропускной способностью; работа диска — 50 мс за посещение. Следите за очередью базы и за тем, как ожидание ответов занимает воркеры API и балансера."}}
		c.Groups[1].Stages[1].Calls[0].Calls = 3
		c.Groups[2].Resources[1].Service = 50
	case "hang":
		c.Cancel = false
		c.Overrides = map[string]NodeConfig{"api-1": {State: "hang"}}
	case "autoscale":
		g := &c.Groups[1]
		g.Count, g.Workers, g.Service = 1, 32, 0
		g.Resources[0].Service = 12
		g.AutoScale = &AutoScalePolicy{Enabled: true, Min: 1, Max: 8, Resource: "compute", Signal: "both", UpUtilization: 70, Window: 5000, UpQueue: 2, DownUtilization: 30, UpDelay: 2000, DownDelay: 10000, Cooldown: 3000}
	case "az":
		c = AZConfig()
	case "numa":
		c = NUMAConfig()
	case "composition":
		c = CompositionConfig()
	default:
		return Config{}, fmt.Errorf("Unknown preset: %s", id)
	}
	return c, nil
}
