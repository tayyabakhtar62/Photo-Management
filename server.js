const express = require("express");
const app = express();
var http = require("http").createServer(app);

var mongodb = require("mongodb");
var ObjectId = mongodb.ObjectId;
var mongoClient = mongodb.MongoClient;

var mainURL = "http://localhost:3000/";
var database = null;

app.use("/public", express.static(__dirname + "/public"));
app.set("view engine", "ejs");
app.use(express.json());

var expressSession = require("express-session");
app.use(expressSession({
    "key": "user_id",
    "secret": "User secret object ID",
    "resave": true,
    "saveUninitialized": true
}));

var bodyParser = require("body-parser");
app.use(bodyParser.json( { limit: "10000mb" } ));
app.use(bodyParser.urlencoded( { extended: true, limit: "10000mb", parameterLimit: 1000000 } ));

var bcrypt = require("bcrypt");

var formidable = require("formidable");
var fileSystem = require("fs");

function getUser(userId, callBack) {
    database.collection("users").findOne({
        "_id": ObjectId(userId)
    }, function (error, result) {
        if (error) {
            console.log(error);
            return;
        }
        if (callBack != null) {
            callBack(result);
        }
    });
}

http.listen(process.env.PORT || 3000, function () {
    console.log("Connected");

    mongoClient.connect("mongodb://localhost:27017", { useUnifiedTopology: true }, function (error, client) {
        if (error) {
            console.log(error);
            return;
        }
        database = client.db("image_sharing_app");

        app.get("/search", async function (request, result) {
            var query = request.query.query;

            var images = await database.collection("images").find({
                "caption": {
                    $regex: query
                }
            }).toArray();

            if (request.session.user_id) {
                getUser(request.session.user_id, function (user) {
                    result.render("search", {
                        "isLogin": true,
                        "query": request.query,
                        "user": user,
                        "images": images,
                        "search": query
                    });
                });
            } else {
                result.render("search", {
                    "isLogin": false,
                    "images": images,
                    "query": request.query,
                    "search": query
                });
            }
        });

        app.get("/", function(request, result) {

            database.collection("images").find().sort({
                "createdAt": -1
            }).toArray(function (error1, images) {

                if (request.session.user_id) {
                    getUser(request.session.user_id, function (user) {
                        result.render("index", {
                            "isLogin": true,
                            "query": request.query,
                            "user": user,
                            "images": images
                        });
                    });
                } else {
                    result.render("index", {
                        "isLogin": false,
                        "query": request.query,
                        "images": images
                    });
                }

            });

        });

        app.get("/register", function(request, result) {
            result.render("register", {
                "query": request.query
            });
        });

        app.post("/register", function (request, result) {

            if (request.body.password != request.body.confirm_password) {
                result.redirect("/register?error=mismatch");
                return;
            }

            database.collection("users").findOne({
                "email": request.body.email
            }, function (error1, user) {
                if (user == null) {
                    bcrypt.hash(request.body.password, 10, function (error3, hash) {
                        database.collection("users").insertOne({
                            "name": request.body.name,
                            "email": request.body.email,
                            "password": hash
                        }, function (error2, data) {
                            result.redirect("/login?message=registered");
                        });
                    });
                } else {
                    result.redirect("/register?error=exists");
                }
            });
        });

        app.get("/login", function(request, result) {
            result.render("login", {
                "query": request.query
            });
        });

        app.post("/login", function (request, result) {
            var email = request.body.email;
            var password = request.body.password;

            database.collection("users").findOne({
                "email": email
            }, function (error1, user) {
                if (user == null) {
                    result.redirect("/login?error=not_exists");
                } else {
                    bcrypt.compare(password, user.password, function (error2, isPasswordVerify) {
                        if (isPasswordVerify) {
                            request.session.user_id = user._id;
                            result.redirect("/");
                        } else {
                            result.redirect("/login?error=wrong_password");
                        }
                    });
                }
            });
        });

        app.get("/logout", function (request, result) {
            request.session.destroy();
            result.redirect("/");
        });

        app.get("/my_uploads", function(request, result) {
            if (request.session.user_id) {
                getUser(request.session.user_id, function (user) {
                    database.collection("images").find({
                        "user._id": ObjectId(request.session.user_id)
                    }).sort({
                        "createdAt": -1
                    }).toArray(function (error1, images) {
                        result.render("index", {
                            "isLogin": true,
                            "query": request.query,
                            "images": images,
                            "user": user
                        });
                    });
                });
            } else {
                result.redirect("/login");
            }
        });

        app.post("/upload-image", async function (request, result) {
            if (request.session.user_id) {
                var formData = new formidable.IncomingForm();
                formData.maxFileSize = 100000 * 1024 * 1024;

                formData.parse(request, function (error1, fields, files) {
                    var oldPath = files.image.path;
                    var newPath = "public/uploads/" + new Date().getTime() + "-" + files.image.name;

                    var caption = fields.caption;

                    fileSystem.readFile(oldPath, function (err, data) {
                        if (err) {
                            throw err;
                        }
                        console.log("File read");

                        fileSystem.writeFile(newPath, data, function (err) {
                            if (err) {
                                throw err;
                            }
                            console.log("File written");

                            getUser(request.session.user_id, function (user) {
                                delete user.password;
                                var currentTime = new Date().getTime();

                                database.collection("images").insertOne({
                                    "filePath": newPath,
                                    "caption": caption,
                                    "user": user,
                                    "createdAt": currentTime,
                                    "likers": [],
                                    "comments": []
                                }, function (error2, data) {
                                    result.redirect("/?message=image_uploaded");
                                });
                            });
                        });

                        fileSystem.unlink(oldPath, function (err) {
                            if (err) {
                                throw err;
                            }
                            console.log("File deleted");
                        });
                    });

                    /*fileSystem.rename(oldPath, newPath, function (error2) {

                        console.log(error2);

                        getUser(request.session.user_id, function (user) {
                            delete user.password;
                            var currentTime = new Date().getTime();

                            database.collection("images").insertOne({
                                "filePath": newPath,
                                "caption": caption,
                                "user": user,
                                "createdAt": currentTime,
                                "likers": [],
                                "comments": []
                            }, function (error2, data) {
                                result.redirect("/?message=image_uploaded");
                            });
                        });
                    });*/
                });
            } else {
                result.redirect("/login");
            }
        });

        app.get("/view-image", function (request, result) {

            database.collection("images").findOne({
                "_id": ObjectId(request.query._id)
            }, function (error1, image) {

                if (request.session.user_id) {
                    getUser(request.session.user_id, function (user) {
                        result.render("view-image", {
                            "isLogin": true,
                            "query": request.query,
                            "image": image,
                            "user": user
                        });
                    });
                } else {
                    result.render("view-image", {
                        "isLogin": false,
                        "query": request.query,
                        "image": image
                    });
                }

            });

        });

        app.post("/do-like", function (request, result) {
            if (request.session.user_id) {
                database.collection("images").findOne({
                    "_id": ObjectId(request.body._id),
                    "likers._id": request.session.user_id
                }, function (error1, video) {
                    if (video == null) {
                        database.collection("images").updateOne({
                            "_id": ObjectId(request.body._id)
                        }, {
                            $push: {
                                "likers": {
                                    "_id": request.session.user_id
                                }
                            }
                        }, function (error2, data) {
                            result.json({
                                "status": "success",
                                "message": "Image has been liked"
                            });
                        });
                    } else {
                        result.json({
                            "status": "error",
                            "message": "You have already liked this image."
                        });
                    }
                });
            } else {
                result.json({
                    "status": "error",
                    "message": "Please login to perform this action."
                });
            }
        });

        app.post("/do-comment", function (request, result) {
            if (request.session.user_id) {
                var comment = request.body.comment;
                var _id = request.body._id;

                getUser(request.session.user_id, function (user) {
                    delete user.password;

                    database.collection("images").findOneAndUpdate({
                        "_id": ObjectId(_id)
                    }, {
                        $push: {
                            "comments": {
                                "_id": ObjectId(),
                                "user": user,
                                "comment": comment,
                                "createdAt": new Date().getTime()
                            }
                        }
                    }, function (error1, data) {
                        result.redirect("/view-image?_id=" + _id + "&message=success#comments");
                    });
                });
            } else {
                result.redirect("/view-image?_id=" + _id + "&error=not_login#comments");
            }
        });

    });
});