CREATE POLICY "Anyone can insert users" ON users 
  FOR INSERT 
  WITH CHECK (true);