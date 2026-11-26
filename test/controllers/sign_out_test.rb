require "test_helper"

class SignOutTest < ActionDispatch::IntegrationTest
  test "header has a sign out button that ends the session" do
    sign_in_as users(:one)
    get root_path
    assert_select "header form.inline-form[action=?] button", session_path, text: "Sign out"

    delete session_path
    assert_redirected_to new_session_path
    get root_path
    assert_redirected_to new_session_path
  end
end
