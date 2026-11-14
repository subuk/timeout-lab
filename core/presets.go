package core

import (
	"fmt"
	"math"
)

// PresetConfig is the single source for every built-in experiment. Faults are
// part of the configuration, so exporting a preset preserves its starting state.
func PresetConfig(id string) (Config, error) {
	c, err := referencePresetConfig(id)
	if err != nil {
		return Config{}, err
	}
	return retimePreset(c), nil
}

func referencePresetConfig(id string) (Config, error) {
	c := referenceDefaultConfig()
	switch id {
	case "normal":
	case "slow":
		c.Description = "Slow disk work makes the database a bottleneck. Watch its queue and the API workers waiting for database responses; compare the effect of timeouts and cancellation."
		labels := c.I18n["ru"]
		labels.Description = "Медленная работа диска делает базу данных узким местом. Следите за её очередью и воркерами API, ожидающими ответов базы; сравните влияние таймаутов и отмены запросов."
		c.I18n["ru"] = labels
		c.Groups[2].Resources[1].Service = 600
	case "fanout":
		c.Name = "Three database calls per request"
		c.Description = "Each API sends three parallel database calls per user request and waits for all three responses. Initially, 30 incoming requests/s imply 90 database calls/s before capacity limits, and disk work is about 333 ms per visit. Watch the database queue grow and the API and load balancer workers wait for downstream responses."
		c.I18n = Localizations{"ru": {Name: "Три вызова БД на один запрос", Description: "На один пользовательский запрос API делает три параллельных вызова базы и ждёт все три ответа. Начальные настройки: 30 запросов/с на входе — номинально 90 вызовов БД/с до ограничения пропускной способностью; работа диска — около 333 мс за посещение. Следите за очередью базы и за тем, как ожидание ответов занимает воркеры API и балансера."}}
		c.Groups[1].Stages[1].Calls[0].Calls = 3
		c.Groups[2].Resources[1].Service = 50
	case "hang":
		c.Description = "One API instance is hung and cancellation is disabled. Watch accepted work occupy workers and queues while callers reach their timeouts."
		labels := c.I18n["ru"]
		labels.Description = "Один экземпляр API завис, отмена запросов отключена. Наблюдайте, как принятая работа занимает воркеры и очереди, пока вызывающие ящики достигают своих таймаутов."
		c.I18n["ru"] = labels
		c.Cancel = false
		c.Overrides = map[string]NodeConfig{"api-1": {State: "hang"}}
	case "autoscale":
		c.Description = "The API starts with one instance. Its autoscaler adds or removes instances based on CPU resource utilization and queue length. Incoming traffic stays constant as the group scales."
		labels := c.I18n["ru"]
		labels.Description = "API начинает с одного экземпляра. Автоскейлер добавляет и убирает экземпляры по утилизации ресурса CPU и длине его очереди. Входящий поток не меняется при масштабировании группы."
		c.I18n["ru"] = labels
		g := &c.Groups[1]
		g.Count, g.Workers, g.Service = 1, 32, 0
		g.Resources[0].Service = 12
		g.AutoScale = &AutoScalePolicy{Enabled: true, Min: 1, Max: 8, Resource: "compute", Signal: "both", UpUtilization: 70, Window: 5000, UpQueue: 2, DownUtilization: 30, UpDelay: 2000, DownDelay: 10000, Cooldown: 3000}
	case "az":
		c = referenceAZConfig()
	case "numa":
		c = referenceNUMAConfig()
	case "composition":
		c = referenceCompositionConfig()
	default:
		return Config{}, fmt.Errorf("Unknown preset: %s", id)
	}
	return c, nil
}

// retimePreset preserves offered work per slot and relative time budgets while
// reducing event throughput. It is only used by built-in constructors: imports
// and live RPS edits keep their literal values. Counts, queues, cost multipliers,
// and randomness are dimensionless and must not change.
func retimePreset(c Config) Config {
	const presetRPS = 30.0
	factor := c.RPS / presetRPS
	// Microsecond precision keeps editable millisecond values readable.
	time := func(v float64) float64 { return math.Round(v*factor*1000) / 1000 }
	normalize(&c) // Materialize inherited connection/controller defaults first.
	c.RPS = presetRPS
	c.Network = time(c.Network)
	c.Deadline = time(c.Deadline)
	c.Client.ConnectTimeout = time(c.Client.ConnectTimeout)
	c.Client.KeepaliveTimeout = time(c.Client.KeepaliveTimeout)
	scale := func(p *float64) *float64 {
		if p == nil {
			return nil
		}
		v := time(*p)
		return &v
	}
	stages := func(ss []Stage) {
		for i := range ss {
			for j := range ss[i].Calls {
				call := &ss[i].Calls[j]
				call.Network = scale(call.Network)
				call.Timeout = scale(call.Timeout)
			}
		}
	}
	var resources func([]ResourceConfig)
	resources = func(rs []ResourceConfig) {
		for i := range rs {
			r := &rs[i]
			r.Service = time(r.Service)
			r.Timeout = scale(r.Timeout)
			r.ConnectTimeout = scale(r.ConnectTimeout)
			r.KeepaliveTimeout = scale(r.KeepaliveTimeout)
			stages(r.Stages)
			resources(r.Resources)
		}
	}
	for i := range c.Groups {
		g := &c.Groups[i]
		g.Service = time(g.Service)
		g.Timeout = time(g.Timeout)
		g.ConnectTimeout = time(g.ConnectTimeout)
		g.KeepaliveTimeout = scale(g.KeepaliveTimeout)
		g.AutoScale.Window = time(g.AutoScale.Window)
		g.AutoScale.UpDelay = time(g.AutoScale.UpDelay)
		g.AutoScale.DownDelay = time(g.AutoScale.DownDelay)
		g.AutoScale.Cooldown = time(g.AutoScale.Cooldown)
		stages(g.Stages)
		resources(g.Resources)
	}
	for id, o := range c.Overrides {
		o.Service = scale(o.Service)
		o.Timeout = scale(o.Timeout)
		o.ConnectTimeout = scale(o.ConnectTimeout)
		o.KeepaliveTimeout = scale(o.KeepaliveTimeout)
		c.Overrides[id] = o
	}
	return c
}
