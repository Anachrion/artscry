class CreateRatings < ActiveRecord::Migration[8.1]
  def change
    create_table :ratings do |t|
      t.references :user, null: false, foreign_key: true, index: false
      t.string :illustration_id, null: false
      t.integer :level, null: false
      t.string :scryfall_id
      t.string :name
      t.string :artist
      t.string :set_name
      t.string :year
      t.string :art_url
      t.string :normal_url
      t.string :large_url
      t.string :scryfall_uri
      t.timestamps
    end
    add_index :ratings, [ :user_id, :illustration_id ], unique: true
    add_index :ratings, [ :user_id, :level ]
  end
end
