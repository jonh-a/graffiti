-- Function to update a single pixel efficiently
CREATE OR REPLACE FUNCTION update_canvas_pixel(
  pixel_x INTEGER,
  pixel_y INTEGER,
  pixel_color TEXT
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE canvas_state
  SET 
    pixels = jsonb_set(
      COALESCE(pixels, '{}'::jsonb),
      ARRAY[pixel_x::text || ',' || pixel_y::text],
      to_jsonb(pixel_color)
    ),
    updated_at = NOW()
  WHERE id = 1;
END;
$$;