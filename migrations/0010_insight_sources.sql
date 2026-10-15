-- Keep the exact input for traceable, on-demand source inspection.
ALTER TABLE ai_suggestions ADD COLUMN source_text TEXT;
