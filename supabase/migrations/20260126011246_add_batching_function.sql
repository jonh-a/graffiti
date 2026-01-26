CREATE OR REPLACE FUNCTION update_canvas_pixels(
  pixel_updates JSONB  -- Format: {"x,y": "color", "x,y": "color", ...}
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  pixel_key TEXT;
  pixel_color TEXT;
BEGIN
  -- Update all pixels in one operation
  UPDATE canvas_state
  SET 
    pixels = pixels || pixel_updates,  -- Merge the updates
    updated_at = NOW()
  WHERE id = 1;
END;
$$;