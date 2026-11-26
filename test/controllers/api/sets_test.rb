require "test_helper"

class Api::SetsTest < ActionDispatch::IntegrationTest
  setup do
    @user = users(:one)
    CardSet.create!(code: "dom", name: "Dominaria", set_type: "expansion", released_at: "2018-04-27", illustration_count: 3)
    CardSet.create!(code: "dmr", name: "Dominaria Remastered", set_type: "masters", released_at: "2023-01-13", illustration_count: 2)
    CardSet.create!(code: "mtgo", name: "Online only", set_type: "expansion", digital: true, illustration_count: 5)
    # "a" is reprinted in both sets.
    [ %w[dom a], %w[dom b], %w[dom c], %w[dmr a], %w[dmr d] ].each do |set, ill|
      Printing.create!(set_code: set, illustration_id: ill)
    end
  end

  test "lists browsable sets with the user's seen and favorite counts" do
    sign_in_as @user
    @user.mark_seen!(%w[a b])
    @user.ratings.create!(illustration_id: "a", level: 2)
    users(:two).mark_seen!(%w[c d])

    get api_sets_path, as: :json
    assert_response :success
    sets = response.parsed_body.index_by { |s| s["code"] }

    assert_equal %w[dmr dom], response.parsed_body.map { |s| s["code"] }, "newest first, digital sets hidden"
    assert_equal({ "total" => 3, "seen" => 2, "favs" => 1 }, sets["dom"].slice("total", "seen", "favs"))
    assert_equal({ "total" => 2, "seen" => 1, "favs" => 1 }, sets["dmr"].slice("total", "seen", "favs"))
  end
end
