# Test account, development only.
# The password "test" is shorter than the 8-character minimum, so validation is skipped on purpose.
if Rails.env.development?
  user = User.find_or_initialize_by(email_address: "user@test.com")
  user.password = "test"
  user.save!(validate: false)
  puts "Dev account: user@test.com / test"
end
