# src/lib/picore

THE ONLY place in NEXUS that reads PI-CORE data (members, roles, positions, periods, assignments). No other file may query PI-CORE tables, views, or functions directly. Why: when PI-CORE publishes its official Integrations API, only this folder needs to change. Rules: read through PI-CORE views or functions only, never write to PI-CORE, and never assume its schema (check the PI-CORE migrations first).
