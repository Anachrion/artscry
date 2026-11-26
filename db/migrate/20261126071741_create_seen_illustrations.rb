class CreateSeenIllustrations < ActiveRecord::Migration[8.1]
  def change
    create_table :seen_illustrations do |t|
      t.references :user, null: false, foreign_key: true, index: false
      t.string :illustration_id, null: false
      t.datetime :created_at, null: false
    end
    add_index :seen_illustrations, [ :user_id, :illustration_id ], unique: true
  end
end
