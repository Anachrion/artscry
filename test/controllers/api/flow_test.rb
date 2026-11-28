require "test_helper"

class Api::FlowTest < ActionDispatch::IntegrationTest
  setup { @user = users(:one) }

  test "requires login" do
    get api_state_path, as: :json
    assert_response :unauthorized
    get root_path
    assert_redirected_to new_session_path
  end

  test "marks illustrations as seen without duplicates" do
    sign_in_as @user
    post api_seen_path, params: { ids: %w[a b a] }, as: :json
    post api_seen_path, params: { ids: %w[b c] }, as: :json
    assert_equal %w[a b c], @user.seen_illustrations.pluck(:illustration_id).sort

    get api_state_path, as: :json
    assert_equal %w[a b c], response.parsed_body["seen"].sort
    assert_kind_of Integer, response.parsed_body["total"]

    delete api_seen_path, as: :json
    assert_equal 0, @user.seen_illustrations.count
  end

  test "rates, re-rates and removes a card" do
    sign_in_as @user
    card = { id: "s1", name: "Shivan Dragon", artist: "Donato", set: "Alpha", year: "1993", art: "a.jpg", normal: "n.jpg", large: "l.jpg", uri: "https://scryfall.com/x" }
    put api_rating_path("ill-1"), params: { level: 2, card: card }, as: :json
    assert_response :success
    put api_rating_path("ill-1"), params: { level: 3 }, as: :json
    rating = @user.ratings.sole
    assert_equal 3, rating.level
    assert_equal "Shivan Dragon", rating.name
    assert @user.seen_illustrations.exists?(illustration_id: "ill-1")

    put api_rating_path("ill-1"), params: { level: 4 }, as: :json
    assert_response :unprocessable_entity

    get api_state_path, as: :json
    assert_equal [ [ "ill-1", 3 ] ], response.parsed_body["ratings"].map { |c| [ c["ill"], c["level"] ] }

    delete api_rating_path("ill-1"), as: :json
    assert_equal 0, @user.ratings.count
  end

  test "users do not see each other's data" do
    sign_in_as users(:two)
    post api_seen_path, params: { ids: %w[z] }, as: :json
    assert_equal 0, @user.seen_illustrations.count
  end

  test "registration creates an account and logs in" do
    post registration_path, params: { user: { email_address: "new@example.com", password: "secretpass", password_confirmation: "secretpass" } }
    assert_redirected_to root_path
    follow_redirect!
    assert_response :success
  end
end
